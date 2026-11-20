// Prepared copies for strangers (#139). A stranger's request for a public door is answered from the copy the worker made,
// with no statement on the database; a person (any house cookie that is not inert, a query) is built fresh and sent
// `private, no-store`, and is never kept or handed to anyone. A copy goes when its work is kept back or taken down,
// is made new when the register names its work, and its visit is still counted inside the house (/api/arrived).
// Run: NODE_ENV=test node test/prepared.js   (with DATABASE_URL, the same on Postgres, less the statement count)
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-prep-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'prep', noTimers: true, vaultNow: true, prepared: true });
  const { db } = app.locals; const pg = db.kind === 'postgres'; const P = app.locals.prepared;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p, cookie = '', o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { ...(cookie ? { cookie } : {}), ...(o.headers || {}) } }).then(async r => ({ status: r.status, h: r.headers, body: await r.text() }));
  let studio = '';
  { const r = await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }); studio = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; '); }
  assert.ok(/wm_s=/.test(studio), 'the Studio signs in');

  // A maker and three held works, written as rows.
  const mid = db.prepare("SELECT id FROM makers ORDER BY id LIMIT 1").get().id;
  const add = (slug, title) => db.prepare("INSERT INTO works (maker_id, slug, title, original_file, sha256, status, width, height, stars, curated) VALUES (?, ?, ?, ?, ?, 'held', 3000, 2000, 4, 1)").run(mid, slug, title, slug + '.jpg', 'sha-' + slug).lastInsertRowid;
  add('prep-one', 'The First Copy'); add('prep-two', 'The Second Copy'); add('prep-three', 'The Third Copy');
  const maker = db.prepare('SELECT * FROM makers WHERE id=?').get(mid); const mslug = app.locals.makerSlug(maker);

  // Every statement the house runs (SQLite: better-sqlite3's prototype, as the scale gate counts).
  const ran = []; let counting = false;
  if (!pg) { const PR = Object.getPrototypeOf(db.prepare('SELECT 1')); for (const m of ['get', 'all', 'run', 'iterate']) { const f = PR[m]; PR[m] = function (...a) { if (counting) ran.push(this.source); return f.apply(this, a); }; } }
  const audit = async fn => { ran.length = 0; counting = true; try { return await fn(); } finally { counting = false; } };

  // Before any copy: a stranger is built fresh and told not to keep it.
  { const r = await go('/w/prep-one'); assert.strictEqual(r.status, 200); assert.ok(!r.h.get('x-prepared'), 'no copy yet'); assert.strictEqual(r.h.get('cache-control'), 'private, no-store', 'a page built fresh is not kept by anyone'); }
  // The person, written first (the proof before the feature): the Studio's page is its own, and is never kept.
  const asStudio = await go('/w/prep-one', studio);
  assert.strictEqual(asStudio.status, 200); assert.ok(!asStudio.h.get('x-prepared')); assert.strictEqual(asStudio.h.get('cache-control'), 'private, no-store', 'a person: private, no-store');
  const stranger0 = await go('/w/prep-one');
  const personal = asStudio.body.split(/(?=<)/).filter(x => x.length > 20 && !stranger0.body.includes(x) && !/csrf|nonce|\d{10,}/i.test(x));
  assert.ok(personal.length > 0, 'the Studio sees what a stranger does not (its edit controls), so the test can tell them apart');
  const n0 = Number(db.prepare('SELECT COUNT(*) n FROM prepared_pages').get().n);
  assert.strictEqual(n0, 0, 'a person’s visit (or a stranger’s) writes no copy: only the worker makes them');

  // The worker's round makes the doors; a stranger's visit to a work names it, and the next round makes its copy.
  db.prepare("INSERT INTO hits (at, path, kind, status, ms, visitor, bot) VALUES (?, '/w/prep-one', 'page', 200, 5, 'v1', 0)").run(Math.floor(Date.now() / 1000));
  db.prepare("INSERT INTO hits (at, path, kind, status, ms, visitor, bot) VALUES (?, '/w/prep-two', 'page', 200, 5, 'v1', 0)").run(Math.floor(Date.now() / 1000));
  const made = await P.round({ all: true }); await P.sync(); await P.sync();
  assert.ok(made.made >= 5, `the doors and the two works asked for are made (${made.made})`);
  const rows = db.prepare('SELECT k FROM prepared_pages WHERE gone=0 ORDER BY k LIMIT 50').all().map(r => r.k);
  for (const k of ['/', '/collection', '/makers', '/wander', '/w/prep-one', '/w/prep-two']) assert.ok(rows.includes(k), `a copy of ${k}`);
  assert.ok(!rows.includes('/w/prep-three'), 'a work no stranger asked for is not made');
  for (const r of db.prepare('SELECT k, body FROM prepared_pages WHERE gone=0 LIMIT 50').all()) for (const x of personal) assert.ok(!r.body.includes(x), `the copy of ${r.k} holds nothing the Studio saw`);

  // A stranger: from the copy, no statement asked, headers a cache in front may keep, and the visit line in the page.
  for (const p of ['/w/prep-one', `/m/${mslug}/prep-one`, '/', '/collection', '/makers', '/wander']) {
    const r = await audit(() => go(p));
    assert.strictEqual(r.status, 200, p); assert.ok(r.h.get('x-prepared') !== null, `${p} from its copy`);
    if (!pg) assert.deepStrictEqual(ran, [], `${p}: no statement on the database in the request`);
    assert.match(r.h.get('cache-control'), /^public, max-age=0, s-maxage=\d+, stale-while-revalidate=\d+$/, `${p}: public for a shared cache, never for the browser`);
    assert.ok(/\/api\/arrived\?p=/.test(r.body), `${p}: the copy says when it arrived`);
    const sc = r.h.getSetCookie ? r.h.getSetCookie() : []; assert.ok(sc.every(c => /^wm_in=collection;/.test(c)), `${p}: no cookie but the collection's own walk (${sc.join(' | ')})`);
  }
  { const r = await go('/w/prep-one'); const again = await go('/w/prep-one', '', { headers: { 'if-none-match': r.h.get('etag') } }); assert.strictEqual(again.status, 304, 'a copy unchanged is a 304'); }
  { const r = await fetch(base + '/w/prep-one', { headers: { 'accept-encoding': 'gzip' } }); assert.strictEqual(r.headers.get('content-encoding'), 'gzip'); assert.ok((await r.text()).includes('The First Copy'), 'the gzip copy reads'); }
  // An address under another maker is not the work's own: the room answers (it redirects), never the copy.
  { const r = await go('/m/someone-else/prep-one'); assert.ok(!r.h.get('x-prepared'), 'another maker’s address is not served from the copy'); }

  // Every kind of person, and a query, is built fresh, private, and never from a copy.
  const PEOPLE = [['the Studio', studio], ['a collector', 'wm_b=1.abc'], ['a maker', 'wm_m=1.abc'], ['the adult rooms', 'wm_zone=mature'], ['a cookie not yet named', 'wm_new=1'], ['a staff key', 'wm_staff=1'], ['an album key', 'wm_pg=abc']];
  const OWN = [['their own looking', 'wm_v=abcdef0123456789'], ['a basket', 'wm_bk=prep-two'], ['a walk', 'wm_in=gallery%3Aabc'], ['a show', 'wm_via=hang%3A3']];
  for (const [who, cookie] of PEOPLE) for (const p of ['/w/prep-one', `/m/${mslug}/prep-one`, '/', '/wander', '/collection', '/makers']) {
    const r = await go(p, cookie);
    assert.ok(!r.h.get('x-prepared'), `${who} on ${p}: built fresh`); assert.strictEqual(r.h.get('cache-control'), 'private, no-store', `${who} on ${p}: private, no-store`);
  }
  // The visitor's own cookies (their looking, basket, walk, show) shape Wander and a work's page: built fresh there.
  for (const [who, cookie] of OWN) for (const p of ['/w/prep-one', '/', '/wander']) {
    const r = await go(p, cookie);
    assert.ok(!r.h.get('x-prepared'), `${who} on ${p}: built fresh`); assert.strictEqual(r.h.get('cache-control'), 'private, no-store', `${who} on ${p}: private, no-store`);
  }
  // The hall's doors read none of them: the same page, so the copy. Proved by building each fresh both ways (a query is built fresh).
  for (const p of ['/collection', '/makers']) {
    const plain = (await go(p + '?fresh=1')).body;
    for (const [who, cookie] of OWN) { const mine = (await go(p + '?fresh=1', cookie)).body; assert.strictEqual(mine, plain, `${who} changes nothing on ${p}`); const r = await go(p, cookie); assert.ok(r.h.get('x-prepared') !== null, `${who} on ${p}: from the copy`); }
  }
  for (const cookie of ['wm_in=1', 'wm_tz=Europe%2FZurich', 'wm_zone=all', 'wm_in=1; wm_tz=America%2FNew_York', 'kh_page=%2F']) { const r = await go('/w/prep-one', cookie); assert.ok(r.h.get('x-prepared') !== null, `a stranger with only ${cookie}: from the copy`); }
  for (const p of ['/w/prep-one?today=1', '/wander?in=collection', '/collection?x=1']) { const r = await go(p); assert.ok(!r.h.get('x-prepared'), `${p}: a query is built fresh`); }
  { const r = await go('/w/prep-one', '', { headers: { 'x-wm-prepare': 'a'.repeat(48) } }); assert.ok(r.h.get('x-prepared') !== null, 'the worker’s header without its key is any stranger'); }
  { const r = await go('/w/prep-one', 'wm_s=forged'); assert.ok(!r.h.get('x-prepared'), 'a cookie that marks a person marks one even when it does not sign in'); }
  // The person's visits changed no copy.
  for (const r of db.prepare('SELECT k, body FROM prepared_pages WHERE gone=0 LIMIT 50').all()) for (const x of personal) assert.ok(!r.body.includes(x), `after the people: the copy of ${r.k} still holds nothing of theirs`);

  // The visit is counted, inside the house: the copy's line, then the batch.
  { app.locals.analytics.flush(); const before = Number(db.prepare("SELECT COUNT(*) n FROM hits WHERE path='/w/prep-one'").get().n);
    const v0 = Number((db.prepare("SELECT COALESCE(SUM(v.count),0) n FROM views v JOIN works w ON w.id=v.work_id WHERE w.slug='prep-one' AND v.kind='view'").get() || {}).n || 0);
    await go('/w/prep-one'); // from the copy: not written as it is sent
    const r = await audit(() => fetch(base + '/api/arrived?p=%2Fw%2Fprep-one&t=42&r=news.example.org', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1.15 Version/18' } }));
    assert.strictEqual(r.status, 204); if (!pg) assert.deepStrictEqual(ran, [], '/api/arrived asks nothing of the database');
    await fetch(base + '/api/arrived?p=%2Fstudio&t=1', { method: 'POST' }); // not a door a copy answers: not counted
    app.locals.analytics.flush(); app.locals.flushViews();
    const hits = db.prepare("SELECT path, status, ms, ref, device FROM hits WHERE path IN ('/w/prep-one', '/studio') ORDER BY id DESC LIMIT 5").all();
    assert.strictEqual(Number(db.prepare("SELECT COUNT(*) n FROM hits WHERE path='/w/prep-one'").get().n) - before, 1, 'one visit, counted once (the copy sent is not written; its line is)');
    assert.deepStrictEqual([hits[0].path, Number(hits[0].status), Number(hits[0].ms), hits[0].ref, hits[0].device], ['/w/prep-one', 200, 42, 'news.example.org', 'phone'], 'the page, the time, where from, the device');
    assert.ok(!hits.some(h => h.path === '/studio'), 'only doors a copy answers are counted from the line');
    const v1 = Number(db.prepare("SELECT COALESCE(SUM(v.count),0) n FROM views v JOIN works w ON w.id=v.work_id WHERE w.slug='prep-one' AND v.kind='view'").get().n);
    assert.strictEqual(v1 - v0, 1, 'and the work’s own view count'); }

  // The register names a work: its copy is made new on the next round.
  { db.prepare("UPDATE works SET title='The First Copy, Retitled' WHERE slug='prep-one'").run();
    require('../src/ledger').append(db, 'work.edited', 'prep-one', { title: true });
    await P.round(); await P.sync(); await P.sync();
    const r = await go('/w/prep-one'); assert.ok(r.h.get('x-prepared') !== null && r.body.includes('Retitled'), 'the copy follows the register'); }
  // Told at the moments the picture copies are told: no longer served at once, made again next round.
  { P.forget('prep-two'); const r = await go('/w/prep-two'); assert.ok(!r.h.get('x-prepared'), 'forgotten: built fresh at once');
    await P.round(); await P.sync(); await P.sync(); const r2 = await go('/w/prep-two'); assert.ok(r2.h.get('x-prepared') !== null, 'and made again by the round'); }
  // Kept back: the copy goes on the next round, and every website stops serving it on its next poll.
  { db.prepare("UPDATE works SET keep_back=1, status='hidden' WHERE slug='prep-two'").run();
    await P.round(); await P.sync();
    const r = await go('/w/prep-two'); assert.ok(!r.h.get('x-prepared'), 'a kept-back work is never served from a copy');
    assert.strictEqual(Number(db.prepare("SELECT gone FROM prepared_pages WHERE k='/w/prep-two'").get().gone), 1, 'its row is a tombstone');
    db.prepare("INSERT INTO hits (at, path, kind, status, ms, visitor, bot) VALUES (?, '/w/prep-two', 'page', 200, 5, 'v2', 0)").run(Math.floor(Date.now() / 1000));
    await P.round({ all: true }); await P.sync(); assert.strictEqual(Number(db.prepare("SELECT gone FROM prepared_pages WHERE k='/w/prep-two'").get().gone), 1, 'and asked for again, it is still not made'); }
  // Another website (a second process): a fresh mirror reads the same rows and serves the same copy; a restart keeps them.
  { const app2 = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'prep', noTimers: true, vaultNow: true, prepared: true });
    await app2.locals.prepared.sync(); const s2 = app2.listen(0); const b2 = `http://127.0.0.1:${s2.address().port}`;
    const r = await fetch(b2 + '/w/prep-one'); const t = await r.text();
    assert.ok(r.headers.get('x-prepared') !== null && t.includes('Retitled'), 'a second website serves the shared copy');
    const r1 = await fetch(b2 + '/collection'); await r1.text(); assert.ok(r1.headers.get('x-prepared') !== null, 'the doors are read at once');
    s2.close(); }
  console.log(`prepared: ok (${pg ? 'postgres' : 'sqlite'}; ${P.state().served} served from copies, ${P.state().persons} people built fresh)`);
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
