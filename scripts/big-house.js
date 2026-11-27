'use strict';
// The scale gate (#8; 9 Nov and 13 Nov, docs/STABILITY.md). Twice a page that read the whole collection held the one web
// process for five to nine seconds a request, and every visitor waited behind it; the second time it was a desk (/studio
// and its Works tab), which a sweep of the visitors' paths had not reached. load.js measures a crowd on a small house;
// this measures every room, once, on a house at the live size, statement by statement, and fails the build on a room
// that would hold the process.
//
//   node scripts/big-house.js            build the house, walk it, judge it (exit 1 on a fault; CI's `scale` job)
//   BIG_KEEP=1 node scripts/big-house.js   the same, the house's folder kept (its path printed) to look into
//   BIG_TABLE=/path/table.md …            the whole table written there as markdown (every room, every person)
//
// 1. The house (`build`, in this process's child): a real house in a temp folder on SQLite, BIG_SEED (6) real pictures
//    registered with their copies, then rows only: BIG_WORKS (100,000) works across BIG_MAKERS (300) makers, cloned
//    from the real ones in the database (every clone points at a real master and copies; no picture is made). Two
//    museums hold most (60% and 25%, as the Met and the Gallery do on live); the house's own maker holds 3,000; one
//    maker, `mk`, holds 400 and is the maker the walk signs in as. Beside them: a register entry per work (the real
//    chain), 3,000 artists, 2,000 collectors, 8,000 licences, three view rows a work, half a stood row a work, 20,000
//    notes, notices, 40 rooms of 30,000 places, three volumes (one of 945 pages, as Leonardo's), 300 albums, letters,
//    a month of hits at three a work (pages, API, pictures, bots), fixity and conditions rows for every work (several
//    for a share), 150 texts, a shelf of 400 books and a book of 1,566 numbered notes (the reader's whole-book page). Deterministic: no random numbers;
//    dates are relative to today. Builds in about ten seconds on the workers' machine (printed: `built in`).
// 2. The worker's round (`worker`): what the worker builds ahead for the website (shared.js), built once, as on live.
// 3. The walk (`walk`): the house as the website (ROLE=web, NODE_ENV=production), every room once, one at a time, as
//    four people: signed out (every room in DOORS, plus a work, a maker, a museum, an artist, a room, an album, a volume,
//    the whole book, the register, Find), the maker `mk` (ROOMS.maker and ROOMS.yours), a museum's desk (ROOMS.institution
//    and ROOMS.maker, as the museum holding 60,000), and the Studio (ROOMS.house, and ROOMS.maker as the house's own
//    maker). Every statement is timed where SQLite runs it (better-sqlite3's run/get/all/iterate and exec), and given to
//    the request in flight: how many, the slowest and its text, the most rows one returned, and the bytes answered.
// 4. The budgets (each fault names the room, the person, the budget and the statement; on CI one annotation each):
//      BIG_STMT_MS  (250)   no single statement longer. Measured 16 Nov on the workers' machine: half the rooms'
//                           slowest statement is under 1 ms, nine in ten under 40 ms; the rooms within every budget
//                           reach 135 ms (the Studio's count of collectors who are not makers; /studio/listening's
//                           sort) — 150 would sit on them and flake on CI's slower runner. 13 Nov's troveRows, restored,
//                           takes 950–1,060 ms here (five seconds on live Postgres): 250 is a quarter of it. Postgres
//                           through the bridge is slower per row than SQLite in process: a statement near 250 ms here
//                           is one to watch there (the table shows them all).
//      BIG_ROWS     (5000)  no statement returns more rows to the process.
//      BIG_PAGE_MS  (1500)  no page longer (the load test's p95 line, here for one request alone).
//      BIG_BYTES    (3 MB)  no response larger.
//      BIG_STMTS    (300)   no page asks more statements (an N+1 shows here first).
//      BIG_READ     (4 MB)  no page is handed more by the database, summed over its statements (#116; live, 20 Nov: a
//                           list that read every book's body took the website over its memory line). The table also
//                           prints how far the process grew on each page (`rssMB` in BIG_JSON), not judged.
//    On Postgres (#116): BIG_PG=<a server url> moves the built house into a fresh database there (scripts/to-postgres.js,
//    then VACUUM ANALYZE; the server's own settings, as live's are assumed default; BIG_PG_SET to try others), runs the
//    worker's round and the walk against it THROUGH THE BRIDGE (a statement's time is the time the thread was held), judges
//    by ALLOW_PG, asks EXPLAIN (ANALYZE, BUFFERS) of every statement over a line after the walk (BIG_PLANS=file.md writes
//    them all), and drops the database. CI's `scale-postgres` job.
//    A known heavy room is in ALLOW below: the room, the budget, what it measured, why, and its issue. It passes on that
//    budget alone, up to its ceiling (`max`); anything new on it, or over the ceiling, fails. An allow line that no
//    longer matches anything is printed as stale (delete it).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const N = +process.env.BIG_WORKS || 100000, MK = +process.env.BIG_MAKERS || 300, SEED = +process.env.BIG_SEED || 6;
// (#116) What grows with the works, as it does on live: three view rows and half a stood row a work, a check of the
// original (fixity) and of the copies (conditions) for every work and several for a share of them, and a month of the
// visit log at three hits a work (pages, the API, pictures, bots; the analytics desk and the digest read it whole).
// (20 Nov, Render's log: the numbers desk's statements over live's `hits` took 9–13 s each on live's database) Live
// logs every page, API call and picture, bots too: the visit log is the house's biggest table and grows with traffic,
// not works, so it is three million a month here at any size up to a million works (three a work above that).
const VIEWS = 3 * N, STOOD = Math.round(N / 2), HITS = +process.env.BIG_HITS || Math.max(3000000, 3 * N);
const B = {
  stmtMs: +process.env.BIG_STMT_MS || 250, rows: +process.env.BIG_ROWS || 5000, pageMs: +process.env.BIG_PAGE_MS || 1500,
  bytes: +process.env.BIG_BYTES || 3 * 1024 * 1024, stmts: +process.env.BIG_STMTS || 300,
  // (#116; 20 Nov, live: 2,929 MB of 2,458 five seconds after one list read every book's body) what the database hands
  // the process for one page, summed over its statements (text by its length, a number 8): the website holds all of it.
  read: +process.env.BIG_READ || 4 * 1024 * 1024,
};
const SECRET = 'big-house';

// The allow-list: rooms known to be over a budget, each with its issue. `room` is the room as the table names it
// (`person room`, or '*' for a statement allowed wherever it lands, which then needs `sql`), `budget` one of stmtMs rows pageMs bytes stmts read, `max` the ceiling it may reach (a little above what
// was measured, so it cannot quietly grow), `sql` (optional) a fragment the offending statement must contain.
const ALLOW = [
  // 16 Nov, the first measurement (#8): every room over a budget at 100,000 works, each with the issue that takes it out.
  // Counts (rows, bytes, statements) are allowed to a quarter above what was measured; times to three times it (CI's
  // runner is slower and shared), and a time is listed when it reached half its line, so a slow run does not flake.
  { room: 'museum /account/sheets', budget: 'rows', max: 75000, issue: 96 }, // measured 60,000 (hidden under #70's Wander cache until #70)
  // 20 Nov (#116): the fixture gained a month of the visit log (3 M hits), four books of 1–2 MB and the read budget.
  // Measured on SQLite on the workers' machine. (/publishing read 6.9 MB until next's reading.js change; the numbers desk
  // over `hits` 11.9 s at 30 days until #114/#120, #125.)
  // 27 Nov (#126): the fixture gained a shelf of 400 books of 20 KB (555 texts), so what grows with books shows.
  { room: 'studio /studio/library', budget: 'read', max: 19000000, issue: 127 }, // 15,201,081 (6,901,863 before the shelf)
  { room: 'studio /studio/reading', budget: 'read', max: 7600000, issue: 232 }, // 6,016,846: the held titles asked 270 times
  { room: 'museum /account/sheets', budget: 'read', max: 10000000, issue: 96 }, // 7,972,307
];

// (#116) The allow-list of the Postgres gate (BIG_PG): the same shape, its own lines, each with its own issue. A room
// can be within its budgets on SQLite and over them through the bridge; that is what this list records.
const ALLOW_PG = [
  // 20 Nov, the first walk through the bridge at 100,000 works (#116), on the workers' machine (2 cores, Postgres 16
  // with its defaults). Counts to a quarter above what was measured; times to three times it (CI's runner and its
  // server in a container are slower), listed when they reached half their line.
  { room: 'museum /account/sheets', budget: 'rows', max: 75000, issue: 96 }, // 60,000
  { room: 'museum /account/sheets', budget: 'stmtMs', max: 800, issue: 96 }, // 268
  { room: 'museum /account/sheets', budget: 'read', max: 10000000, issue: 96 }, // 7,972,307
  { room: 'studio /studio/fixity', budget: 'stmtMs', max: 450, issue: 128, sql: 'FROM fixity' }, // 143
  { room: 'studio /studio', budget: 'stmtMs', max: 400, issue: 129 }, // 131: the month's most viewed
  { room: 'visitor /house', budget: 'stmtMs', max: 600, issue: 130 }, // 196
  // 27 Nov (#126): the fixture gained a shelf of 400 books of 20 KB (555 texts), so what grows with books shows.
  { room: 'studio /studio/library', budget: 'read', max: 19000000, issue: 127 }, // 15,201,081 (6,901,863 before the shelf)
  { room: 'studio /studio/reading', budget: 'read', max: 7600000, issue: 232 }, // 6,016,846: the held titles asked 270 times
];

// ---------------------------------------------------------------------------------------------------------------- build
function build(dir) {
  process.env.NODE_ENV = 'test';
  const sharp = require('sharp');
  const { createApp } = require(path.join(ROOT, 'src/app'));
  const L = require(path.join(ROOT, 'src/ledger'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: SECRET, noTimers: true, vaultNow: true });
  const { db, registerWork } = app.locals;
  const house = app.locals.maker.id;
  const t0 = Date.now(), lap = {};
  const step = (k, fn) => { const t = Date.now(); const r = fn(); lap[k] = Date.now() - t; return r; };
  return (async () => {
    // The real works: small pictures, their copies made, as the fixtures do.
    const seeds = [];
    for (let i = 0; i < SEED; i++) {
      const f = path.join(dir, `seed${i}.jpg`);
      await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40 + i * 30, g: 90, b: 160 - i * 20 } } }).jpeg({ quality: 80 }).toFile(f);
      const w = await registerWork({ file: f, originalName: `seed${i}.jpg`, title: `Seed ${i}`, place: 'Paris' });
      try { await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE id=?').get(w.id)); } catch (e) { console.error('copies', e.message); }
      seeds.push(w.id);
    }
    lap.seed = Date.now() - t0;
    const R = (n, sql) => `WITH RECURSIVE s(g) AS (SELECT 1 UNION ALL SELECT g+1 FROM s WHERE g < ${n}) ${sql}`;
    db.transaction(() => {
      step('makers', () => {
        const ins = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, email_ok, place) VALUES (?, ?, ?, ?, datetime('now','-200 day'), 'house', 1, ?)");
        ins.run('museum-a', 'Museum A', 'a@museum.example', 'institution', 'New York');
        ins.run('museum-b', 'Museum B', 'b@museum.example', 'institution', 'Washington');
        ins.run('mk', 'Mira Kell', 'mk@example.com', 'maker', 'Dallas');
        db.exec(R(MK - 4, "INSERT INTO makers (handle, name, email, kind, joined_at, door, email_ok, place) SELECT 'maker-' || g, 'Maker ' || g, 'maker' || g || '@example.com', 'maker', datetime('now', '-' || (g % 300) || ' day'), CASE WHEN g % 3 = 0 THEN 'record' ELSE 'house' END, 1, 'Paris' FROM s"));
      });
      step('artists', () => db.exec(R(3000, "INSERT INTO artists (slug, name, sort_name, born, died, nationality) SELECT 'artist-' || g, 'Artist ' || g, 'Artist ' || g, 1400 + (g % 500), 1460 + (g % 500), 'European' FROM s")));
      const id = h => db.prepare('SELECT id FROM makers WHERE handle=?').get(h).id;
      const A = id('museum-a'), Bm = id('museum-b'), M = id('mk'), first = id('maker-1');
      // works: g 1..3000 the house; then 60% museum A, 25% museum B, 400 mk, the rest across the other makers.
      const nA = Math.round(N * 0.6), nB = Math.round(N * 0.25), nH = 3000, nM = 400;
      const tpl = 'works';
      const cols = Object.keys(db.prepare('SELECT * FROM works WHERE id=?').get(seeds[0]));
      const over = {
        maker_id: `CASE WHEN g <= ${nH} THEN ${house} WHEN g <= ${nH + nA} THEN ${A} WHEN g <= ${nH + nA + nB} THEN ${Bm} WHEN g <= ${nH + nA + nB + nM} THEN ${M} ELSE ${first} + (g % ${MK - 4}) END`,
        slug: "'bh-' || g", title: "(CASE g % 7 WHEN 0 THEN 'Study of a river' WHEN 1 THEN 'Portrait of a woman' WHEN 2 THEN 'Street, evening' WHEN 3 THEN 'The harbour' WHEN 4 THEN 'Still life with lemons' WHEN 5 THEN 'Window in Kyoto' ELSE 'Untitled' END) || ' ' || g",
        place: "(CASE g % 12 WHEN 0 THEN 'Paris' WHEN 1 THEN 'Florence' WHEN 2 THEN 'London' WHEN 3 THEN 'New York' WHEN 4 THEN 'Kyoto' WHEN 5 THEN 'Lisbon' WHEN 6 THEN 'Rome' WHEN 7 THEN 'Vienna' WHEN 8 THEN 'Dallas' WHEN 9 THEN 'Boston' WHEN 10 THEN 'Milan' ELSE 'Venice' END)",
        taken_at: "(1850 + (g % 175)) || '-06-15 12:00:00'", caption: "CASE WHEN g % 3 = 0 THEN 'A caption for work ' || g ELSE NULL END",
        keywords: "CASE WHEN g % 2 = 0 THEN 'river, light, ' || (g % 50) ELSE NULL END", stars: 'g % 6', curated: 'CASE WHEN g % 40 = 0 THEN 1 ELSE 0 END',
        status: "CASE WHEN g % 50 = 0 THEN 'hidden' ELSE 'held' END", hall: `CASE WHEN g > ${nH} AND g <= ${nH + nA + nB} THEN 1 WHEN g % 9 = 0 THEN 1 ELSE 0 END`,
        open: `CASE WHEN g > ${nH} AND g <= ${nH + nA + nB} THEN 'pd' ELSE NULL END`, artist_id: `CASE WHEN g > ${nH} AND g <= ${nH + nA + nB} THEN 1 + (g % 3000) ELSE NULL END`,
        accession: "'BH.' || g", sha256: "printf('%064x', g)", dhash: "printf('%016x', (g * 2654435761) % 9007199254740991)", width: '4000', height: '3000',
        created_at: "datetime('now', '-' || (g % 400) || ' day')", vol_page: 'NULL',
      };
      const list = cols.filter(c => c !== 'id');
      step('works', () => db.exec(R(N - SEED, `INSERT INTO works (${list.join(', ')}) SELECT ${list.map(c => over[c] || 't.' + c).join(', ')} FROM s JOIN ${tpl} t ON t.id = (CASE s.g % ${SEED} ${seeds.map((x, i) => `WHEN ${i} THEN ${x}`).join(' ')} END)`)));
      step('collectors', () => {
        db.exec(R(2000, "INSERT INTO buyers (customer, email, name, code, created_at) SELECT 'cus_bh' || g, 'collector' || g || '@example.com', 'Collector ' || g, 'C' || g, datetime('now', '-' || (g % 300) || ' day') FROM s"));
        db.prepare("INSERT INTO buyers (customer, email, name, code) VALUES ('cus_mk', 'mk@example.com', 'Mira Kell', 'CMK')").run();
        db.prepare("UPDATE makers SET buyer_id=(SELECT id FROM buyers WHERE customer='cus_mk') WHERE id=?").run(M);
      });
      const lo = db.prepare('SELECT MIN(id) a, MAX(id) b FROM works').get(), W = lo.b - lo.a + 1;
      const wk = e => `(${lo.a} + ((${e}) % ${W}))`;
      const b0 = db.prepare('SELECT MIN(id) a FROM buyers').get().a;
      const uses = db.prepare('SELECT id FROM uses WHERE maker_id=? ORDER BY id').all(house).map(r => r.id);
      step('licences', () => db.exec(R(8000, `INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, buyer_id, collector_no, created_at, starts_at, ends_at)
        SELECT 'WM-BH-' || printf('%06d', g), ${wk('CASE WHEN g % 3 = 0 THEN g % 3000 ELSE g * 7919 END')}, (CASE g % ${uses.length} ${uses.map((x, i) => `WHEN ${i} THEN ${x}`).join(' ')} END),
          'Collector ' || (g % 2000), 'collector' || (g % 2000) || '@example.com', 2500 + (g % 40) * 500,
          CASE g % 10 WHEN 0 THEN 'requested' WHEN 1 THEN 'expired' WHEN 2 THEN 'declined' ELSE 'active' END, ${b0} + (g % 2000),
          CASE WHEN g % 4 = 0 THEN g ELSE NULL END, datetime('now', '-' || (g % 365) || ' day'), datetime('now', '-' || (g % 365) || ' day'), CASE WHEN g % 5 = 0 THEN datetime('now', '+' || (g % 90) || ' day') ELSE NULL END FROM s`)));
      step('views', () => db.exec(R(VIEWS, `INSERT INTO views (work_id, host, kind, day, count) SELECT ${lo.a} + (g % ${W}), 'watermark', 'view', date('now', '-' || (g / ${W} * 29 + g % 29) || ' day'), 1 + (g % 9) FROM s`)));
      step('stood', () => db.exec(R(STOOD, `INSERT INTO stood (work_id, viewer, buyer_id, n, at, seconds, visits, last_at) SELECT ${wk('g * 104729')}, 'v' || (g % 9000), CASE WHEN g % 5 = 0 THEN ${b0} + (g % 2000) ELSE NULL END, 1, datetime('now', '-' || (g % 60) || ' day'), 5 + (g % 120), 1 + (g % 3), datetime('now', '-' || (g % 60) || ' day') FROM s`)));
      step('notes', () => {
        db.exec(R(20000, `INSERT INTO notes (work_id, buyer_id, name, body, at) SELECT ${wk('g * 15485863')}, ${b0} + (g % 2000), 'Collector', 'A note on this work, number ' || g || '.', datetime('now', '-' || (g % 200) || ' day') FROM s`));
        db.exec(R(20000, `INSERT INTO applause (work_id, buyer_id, at) SELECT ${wk('g * 32452843')}, ${b0} + (g % 2000), datetime('now', '-' || (g % 200) || ' day') FROM s`));
        db.exec(R(1500, `INSERT INTO notices (maker_id, kind, title, body, href, at) SELECT ${M}, 'view', 'Your work was seen', 'Seen ' || g || ' times', '/w/bh-' || g, datetime('now', '-' || (g % 90) || ' day') FROM s`));
        db.exec(R(3000, `INSERT INTO notices (maker_id, kind, title, body, href, at) SELECT ${house}, 'license', 'A licence', 'Licence ' || g, '/studio/licenses', datetime('now', '-' || (g % 90) || ' day') FROM s`));
      });
      step('rooms', () => {
        db.exec(R(40, "INSERT INTO collections (slug, title, note, public, sort) SELECT 'room-' || g, 'Room ' || g, 'The wall text of room ' || g, 1, g FROM s"));
        const c0 = db.prepare('SELECT MIN(id) a FROM collections').get().a;
        db.exec(R(30000, `INSERT INTO collection_works (collection_id, work_id, sort) SELECT ${c0} + (g % 40), ${lo.a} + g * 3, g FROM s`));
      });
      step('volumes', () => {
        const vi = db.prepare("INSERT INTO volumes (slug, stem, title, line, artist_id, status, n, created_at, opened_at) VALUES (?, ?, ?, 'A codex', ?, 'open', ?, datetime('now'), datetime('now'))");
        const vp = db.prepare("INSERT INTO volume_pages (volume_id, work_id, pos, label, placed) VALUES (?, ?, ?, ?, datetime('now'))");
        const setv = db.prepare('UPDATE works SET vol_page=? WHERE id=?');
        const aw = db.prepare('SELECT id FROM works WHERE maker_id=? ORDER BY id LIMIT ? OFFSET ?');
        let off = 0;
        for (const [slug, n] of [['codex-big', 945], ['codex-small', 60], ['codex-tiny', 12]]) {
          const ws = aw.all(A, n, off).map(r => r.id); off += n;
          const v = Number(vi.run(slug, slug, 'Codex ' + slug, 1, ws.length).lastInsertRowid);
          ws.forEach((w, i) => { vp.run(v, w, i + 1, 'f. ' + (i + 1)); setv.run(i === 0 ? 0 : v, w); });
        }
      });
      step('albums', () => {
        db.exec(R(300, `INSERT INTO deliveries (token, maker_id, title, client_name, client_email, status, created_at, share_token) SELECT 'album' || g, CASE WHEN g <= 20 THEN ${M} WHEN g <= 60 THEN ${house} ELSE ${first} + (g % ${MK - 4}) END, 'Album ' || g, 'Client ' || g, 'client' || g || '@example.com', 'open', datetime('now', '-' || g || ' day'), 'share' || g FROM s`));
        const d0 = db.prepare('SELECT MIN(id) a FROM deliveries').get().a;
        const mkw = db.prepare('SELECT MIN(id) a FROM works WHERE maker_id=?').get(M).a;
        db.exec(R(9000, `INSERT INTO delivery_works (delivery_id, work_id, pos, ref) SELECT ${d0} + (g % 300), CASE WHEN g % 300 < 20 THEN ${mkw} + ((g / 300) * 13) % 400 ELSE ${lo.a} + (g * 11) % ${W} END, g / 300, 'r' || g FROM s`));
      });
      step('letters', () => {
        db.exec(R(20000, `INSERT INTO letters (buyer_id, month, sent_at) SELECT ${b0} + (g % 2000), strftime('%Y-%m', date('now', '-' || (g / 2000) || ' month')), datetime('now', '-' || (g / 2000) || ' month') FROM s`));
        const l0 = db.prepare('SELECT MIN(id) a FROM licenses').get().a;
        db.exec(R(5000, `INSERT INTO wall_letters (license_id, at) SELECT ${l0} + g, datetime('now', '-' || (g % 100) || ' day') FROM s`));
      });
      // A month of the visit log, evenly over thirty days (at in seconds, as the house writes it): of every twenty hits
      // seven are people's pages, two the API, seven pictures, four bots (no visitor, as the house keeps them); one in
      // 97 a 404 and one in 1,999 a 500; a tenth as many visitors as hits; referrers, devices, browsers, countries mixed.
      step('hits', () => db.exec(R(HITS, `INSERT INTO hits (at, path, kind, status, ms, visitor, ref, device, browser, bot, country, bytes)
        SELECT CAST(strftime('%s', 'now') AS INTEGER) - (g * ${Math.max(1, Math.floor(2592000e3 / HITS))} / 1000),
          CASE WHEN g % 20 < 7 OR g % 20 >= 16 THEN (CASE g % 5 WHEN 0 THEN '/wander' WHEN 1 THEN '/w/bh-' || ((g * 7919) % ${N}) WHEN 2 THEN '/' WHEN 3 THEN '/look' ELSE '/m/maker-' || (g % 300) END)
            WHEN g % 20 < 9 THEN (CASE g % 3 WHEN 0 THEN '/api/stroll' WHEN 1 THEN '/api/find' ELSE '/api/v1/works' END) ELSE '/img/bh-' || (g % ${N}) || '-screen.webp' END,
          CASE WHEN g % 20 < 7 OR g % 20 >= 16 THEN 'page' WHEN g % 20 < 9 THEN 'api' ELSE 'img' END,
          CASE WHEN g % 1999 = 0 THEN 500 WHEN g % 97 = 0 THEN 404 ELSE 200 END, 20 + (g % 300) + (CASE WHEN g % 50 = 0 THEN g % 2000 ELSE 0 END),
          CASE WHEN g % 20 >= 16 THEN NULL ELSE 'v' || (g % ${Math.max(1000, Math.round(HITS / 10))}) END,
          CASE WHEN g % 20 >= 16 THEN NULL WHEN g % 7 = 0 THEN 'https://www.instagram.com/' WHEN g % 11 = 0 THEN 'https://www.google.com/' ELSE NULL END,
          CASE g % 3 WHEN 0 THEN 'phone' WHEN 1 THEN 'desktop' ELSE 'tablet' END, CASE g % 3 WHEN 0 THEN 'safari' WHEN 1 THEN 'chrome' ELSE 'firefox' END,
          CASE WHEN g % 20 >= 16 THEN 1 ELSE 0 END, CASE g % 4 WHEN 0 THEN 'US' WHEN 1 THEN 'FR' WHEN 2 THEN 'GB' ELSE NULL END, 20000 + (g % 50000) FROM s`)));
      // Every work's original checked (fixity) and its copies looked over (conditions), as the worker's rounds leave them:
      // one check a work two to three months ago, and more since for a share (every fifth work three more fixity checks,
      // every tenth two more conditions); one check in 997 failed, one condition in 499 unsound.
      step('fixity', () => {
        const F = Math.ceil(W / 5), C = Math.ceil(W / 10);
        db.exec(R(W + 3 * F, `INSERT INTO fixity (work_id, checked_at, ok, sha256, note) SELECT CASE WHEN g <= ${W} THEN ${lo.a} + g - 1 ELSE ${lo.a} + ((g - ${W} - 1) % ${F}) * 5 END,
          CASE WHEN g <= ${W} THEN datetime('now', '-' || (60 + g % 30) || ' day', '-' || (g % 1440) || ' minute') ELSE datetime('now', '-' || ((g - ${W}) % 60) || ' day', '-' || (g % 1440) || ' minute') END,
          CASE WHEN g % 997 = 0 THEN 0 ELSE 1 END, printf('%064x', g), CASE WHEN g % 997 = 0 THEN 'the bytes differ' ELSE NULL END FROM s`));
        db.exec(R(W + 2 * C, `INSERT INTO conditions (work_id, ok, decode, fixity, dims, renders, findings, checked_at) SELECT CASE WHEN g <= ${W} THEN ${lo.a} + g - 1 ELSE ${lo.a} + ((g - ${W} - 1) % ${C}) * 10 END,
          CASE WHEN g % 499 = 0 THEN 0 ELSE 1 END, 1, 1, 1, CASE WHEN g % 499 = 0 THEN 0 ELSE 4 END, CASE WHEN g % 499 = 0 THEN '["a copy would not open"]' ELSE NULL END,
          CASE WHEN g <= ${W} THEN datetime('now', '-' || (60 + g % 30) || ' day') ELSE datetime('now', '-' || ((g - ${W}) % 60) || ' day') END FROM s`));
      });
      step('texts', () => {
        db.exec(R(150, `INSERT INTO texts (slug, kind, title, author, maker_id, body, public, status, created_at, updated_at) SELECT 'text-' || g, CASE WHEN g % 3 = 0 THEN 'essay' ELSE 'book' END, 'A text ' || g, 'Author ' || g, CASE WHEN g % 10 = 0 THEN ${M} ELSE ${house} END, '## One\n\n' || 'A paragraph of the text, plain and short. ' || g || '\n\n## Two\n\nAnother.', 1, 'held', datetime('now'), datetime('now') FROM s`));
        db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES ('notes-book', 'book', 'A Book of Notes', 'An author of the past', ?, 1, 'held', 'https://example.org/notes', 'Public domain.')").run(notesBook());
        // (20 Nov, live: the reading room's list read every book's whole body, 7.8 s, then the website over its memory line)
        // Live holds the Leonardo notebooks (about 1.5 MB of text) and other whole books: four of 1 to 2 MB here.
        const big = db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms, created_at, updated_at) VALUES (?, 'book', ?, 'An author of the past', ?, 1, 'held', 'https://example.org/big', 'Public domain.', datetime('now'), datetime('now'))");
        [1.0, 1.3, 1.6, 2.0].forEach((mb, i) => { const para = `A long paragraph of a whole book, number ${i + 1}, written out as the source has it, plainly and at length, so the body is the size of a real one. `; const out = []; let n = 0, k = 0; while (n < mb * 1048576) { const ch = k % 40 === 0 ? `\n\n## Chapter ${k / 40 + 1}\n\n` : '\n\n'; out.push(ch + para + para); n += ch.length + para.length * 2; k++; } big.run(`big-book-${i + 1}`, `A Whole Book ${i + 1}`, out.join('')); });
        // (#126, 27 Nov; live: Wander's shelf read whole books to choose a paragraph, 8.5 s on the thread) A shelf of
        // books, so a statement that grows with books shows: BIG_BOOKS (400) of BIG_BOOK_KB (20) each, forty chapters,
        // every paragraph one the shelf could show. `BIG_BOOKS=200 BIG_BOOK_KB=1000` is a library of whole books.
        const NB = process.env.BIG_BOOKS != null ? +process.env.BIG_BOOKS : 400, KB = +process.env.BIG_BOOK_KB || 20;
        const shelfBook = db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'held', 'https://example.org/shelf', 'Public domain.', datetime('now'), datetime('now'))");
        db.transaction(() => { for (let b = 1; b <= NB; b++) { const out = []; let n = 0, k = 0; const per = Math.max(1, Math.ceil(KB * 1024 / 300 / 40)); while (n < KB * 1024) { const ch = k % per === 0 ? `## Chapter ${k / per + 1}\n\n` : ''; const para = `Paragraph ${k + 1} of shelf book ${b} stands whole on its own, begins like a sentence and ends like one, and runs to about the length a reader copies out into a commonplace book, neither a line nor a page, so the shelf has something true to show for every book that stands on it.`; out.push(ch + para); n += ch.length + para.length + 2; k++; } shelfBook.run(`shelf-book-${b}`, b % 5 === 0 ? 'essay' : 'book', `A Shelf Book ${b}`, `Author, Shelf ${b % 40}`, out.join('\n\n')); } })();
      });
    })();
    // The register: one entry a work, chained and signed as the house does it.
    step('register', () => {
      const last = db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get();
      L.ensureSig(db);
      const ins = db.prepare('INSERT INTO ledger (seq, at, type, subject, data, prev_hash, hash, sig) VALUES (@seq,@at,@type,@subject,@data,@prev_hash,@hash,@sig)');
      let seq = last ? last.seq : 0, prev = last ? last.hash : '0'.repeat(64); const at = new Date(Date.now() - 86400e3).toISOString();
      const rows = db.prepare("SELECT slug, sha256 FROM works WHERE slug LIKE 'bh-%' ORDER BY id").raw().all();
      db.transaction(() => { for (const [slug, sha] of rows) { const e = { seq: ++seq, at, type: 'work.registered', subject: slug, data: JSON.stringify({ sha256: sha }), prev_hash: prev }; e.hash = L.digest(e); e.sig = L.sign(e.hash); ins.run(e); prev = e.hash; } })();
    });
    step('indexes', () => { require(path.join(ROOT, 'src/indexes')).ensure(db); db.exec('ANALYZE'); });
    const count = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const sizes = Object.fromEntries(['makers', 'works', 'artists', 'buyers', 'licenses', 'views', 'stood', 'notes', 'notices', 'collection_works', 'volume_pages', 'deliveries', 'delivery_works', 'letters', 'hits', 'fixity', 'conditions', 'texts', 'ledger'].map(t => [t, count(t)]));
    const bytes = fs.readdirSync(dir).filter(f => /\.(db|sqlite)(-wal)?$/.test(f) || /\.db/.test(f)).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
    console.log('@@' + JSON.stringify({ ms: Date.now() - t0, lap, sizes, dbMB: Math.round(bytes / 1048576) }));
    process.exit(0);
  })();
}

// A book of numbered notes in the shape outline.js recognises (as test/outline.js builds it, longer): contents, 22
// sections under bare roman numerals, 1,566 notes of three paragraphs each (about the size of Richter's Leonardo).
function notesBook() {
  const roman = n => { const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
  const out = ['A Book of Notes, compiled from the manuscripts.', 'Volume 1', 'PREFACE.', 'A few conventions are explained here.', 'CONTENTS OF VOLUME I.'];
  for (let s = 2; s <= 22; s++) out.push(`${roman(s)}.`, `Section ${s} of the notes.`, `Topics of section ${s} (${(s - 1) * 71}—${s * 71}).`);
  out.push('## The First Section');
  let n = 1;
  for (let s = 1; s <= 22; s++) {
    if (s > 1) out.push(`${roman(s)}.`, `Section ${s} of the notes.`);
    for (let k = 0; k < 71 && n <= 1566; k++, n++) {
      out.push(`${n}.`, `The text of note ${n}, in the author's words: of light and shade, of water and the way it moves, of the eye and what it sees—as the source has it, with (brackets) and dashes.`,
        `A second paragraph of note ${n}, which carries on the thought at some length, as the notebooks do, turning it over from another side and coming back to where it began.`,
        `[Footnote: In the original the lines of note ${n} run on the margin.] C.A. ${100 + n}b; ${200 + n}a]`);
    }
  }
  return out.join('\n\n');
}

// ---------------------------------------------------------------------------------------------------------------- worker
function worker(dir) {
  const { createApp } = require(path.join(ROOT, 'src/app'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: SECRET, noTimers: true });
  const built = []; const t = Date.now();
  for (let i = 0; i < 40; i++) { const t1 = Date.now(); const k = app.locals.shared.round(); if (!k) break; built.push(`${k} ${Date.now() - t1} ms`); }
  // (#114) the worker's round of the numbers, so the walk finds the desk, the digest and the agents' desk open on the kept answer
  // (#126) the worker's round of the shelf: every book read once, here, and its passages kept for the website
  if (app.locals.commonplace && app.locals.commonplace.gather) { const t1 = Date.now(); let books = 0, kept = 0; for (let i = 0; i < 400; i++) { const g = app.locals.commonplace.gather(); books += g.books; kept += g.kept; if (!g.more) break; } built.push(`passages ${Date.now() - t1} ms (${books} books read, ${kept} passages kept)`); }
  if (app.locals.numbers) { const n = app.locals.numbers.makeAll(); built.push(`numbers ${n.ms} ms${n.failed.length ? ' (failed: ' + n.failed.join(', ') + ')' : ''}`); }
  console.log('@@' + JSON.stringify({ ms: Date.now() - t, built }));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------- walk
// Every statement SQLite runs, timed and given to the request in flight (the walk asks one room at a time).
let cur = null;
const PG = !!process.env.DATABASE_URL; // the walk's house is on Postgres, through the bridge (#116)
const now = () => Number(process.hrtime.bigint()) / 1e6;
// Over-budget statements kept with their parameters, so their plans can be asked for after the walk (Postgres only).
const toExplain = new Map(); // sql → { ms, rows, params, room }
const keepParams = a => { try { return JSON.parse(JSON.stringify(a.length === 1 && a[0] && typeof a[0] === 'object' ? a[0] : a)); } catch (e) { return null; } };
// The bytes a result hands the process: strings by length, anything else 8 (cheap enough to run on every answer).
function sizeOf(r) {
  if (r == null) return 0; if (typeof r === 'string') return r.length; if (Buffer.isBuffer(r)) return r.length;
  if (Array.isArray(r)) { let n = 0; for (const x of r) n += sizeOf(x); return n; }
  if (typeof r === 'object') { let n = 0; for (const k in r) n += sizeOf(r[k]); return n; }
  return 8;
}
function note(sql, ms, rows, args, bytes = 0) {
  if (!cur) return;
  // The house's own log of visits is kept in memory and written every five seconds, in one batch, whichever room is
  // being walked when the clock strikes (18 Nov: /studio read 304 statements, 199 of them the batch). It is no room's.
  if (/^\s*INSERT INTO hits\b/.test(sql)) return;
  cur.n++; cur.dbMs += ms; cur.read += bytes; if (bytes > cur.big.bytes) cur.big = { bytes, sql };
  const k = cur.by.get(sql) || { n: 0, ms: 0 }; k.n++; k.ms += ms; cur.by.set(sql, k);
  if (ms > cur.slow.ms) cur.slow = { ms, sql };
  if (rows > cur.most.rows) cur.most = { rows, sql };
  if (ms > B.stmtMs || rows > B.rows) {
    cur.over.push({ ms, rows, sql });
    const was = toExplain.get(sql);
    if (PG && args && (!was || ms > was.ms)) toExplain.set(sql, { ms, rows, params: keepParams(args), room: `${cur.who} ${cur.room}` });
  }
}
function hook() {
  const Database = require('better-sqlite3');
  const mem = new Database(':memory:'); const P = Object.getPrototypeOf(mem.prepare('SELECT 1')); mem.close();
  for (const m of ['run', 'get', 'all']) {
    const o = P[m];
    P[m] = function (...a) {
      if (!cur) return o.apply(this, a);
      const t = now(); const r = o.apply(this, a); const ms = now() - t;
      note(this.source, ms, m === 'all' ? r.length : m === 'get' ? (r === undefined ? 0 : 1) : 0, null, m === 'run' ? 0 : sizeOf(r)); return r;
    };
  }
  const oi = P.iterate;
  P.iterate = function (...a) {
    if (!cur) return oi.apply(this, a);
    const sql = this.source; let t = now(); const it = oi.apply(this, a); let ms = now() - t, rows = 0, bytes = 0; const rec = cur;
    return { [Symbol.iterator]() { return this; }, next() { const t1 = now(); const r = it.next(); ms += now() - t1; if (r.done) { const c = cur; cur = rec; note(sql, ms, rows, null, bytes); cur = c; } else { rows++; bytes += sizeOf(r.value); } return r; }, return(v) { const c = cur; cur = rec; note(sql, ms, rows, null, bytes); cur = c; return it.return ? it.return(v) : { done: true, value: v }; } };
  };
  const oe = Database.prototype.exec;
  Database.prototype.exec = function (sql) { if (!cur) return oe.call(this, sql); const t = now(); const r = oe.call(this, sql); note(sql, now() - t, 0); return r; };
}

// (#116) The same on Postgres, through the bridge, as the website feels it: every call into src/pgsync.js holds this
// process's one thread until the answer is back and parsed (Atomics.wait), so the time measured is the time the thread
// was held, round trip and JSON included. The bridge itself is not touched: its `open` is wrapped from here, before the
// house opens its database, and every statement it prepares is wrapped (get, all, run, iterate, pluck, raw; exec).
// What is not counted: the BEGIN/COMMIT a db.transaction() sends through the bridge's own exec (it holds the thread too).
function hookPg() {
  const S = require(path.join(ROOT, 'src/pgsync'));
  const open = S.open;
  const timed = (sql, fn, rowsOf, a) => { if (!cur) return fn(); const t = now(); const r = fn(); note(sql, now() - t, rowsOf(r), a, rowsOf(r) ? sizeOf(r) : 0); return r; };
  const nrows = r => Array.isArray(r) ? r.length : r === undefined ? 0 : 1;
  const wrapRead = (sql, o, a) => ({
    get: (...p) => timed(sql, () => o.get(...p), nrows, p),
    all: (...p) => timed(sql, () => o.all(...p), nrows, p),
    ...(o.iterate ? { iterate: (...p) => { const rows = timed(sql, () => [...o.iterate(...p)], nrows, p); return rows[Symbol.iterator](); } } : {}),
  });
  S.open = url => {
    const db = open(url);
    const prep = db.prepare, ex = db.exec;
    db.prepare = sql => {
      const st = prep(sql);
      return {
        ...st,
        get: (...p) => timed(sql, () => st.get(...p), nrows, p),
        all: (...p) => timed(sql, () => st.all(...p), nrows, p),
        run: (...p) => timed(sql, () => st.run(...p), () => 0, p),
        iterate: (...p) => { const rows = timed(sql, () => [...st.iterate(...p)], nrows, p); return rows[Symbol.iterator](); },
        pluck: () => wrapRead(sql, st.pluck()),
        raw: () => wrapRead(sql, st.raw()),
      };
    };
    db.exec = sql => timed(sql, () => ex(sql), () => 0, null);
    db.unwrapped = { prepare: prep, exec: ex };
    return db;
  };
}

// (#116) The plans of the statements that went over, asked for after the walk, never during it: EXPLAIN (ANALYZE,
// BUFFERS) with the parameters the room used. A statement that writes is explained inside a transaction rolled back.
function explainAll(db) {
  const out = [];
  const list = [...toExplain].sort((a, b) => b[1].ms - a[1].ms).slice(0, +process.env.BIG_EXPLAIN || 40);
  for (const [sql, o] of list) {
    const write = !/^\s*(SELECT|WITH)\b/i.test(sql);
    let plan;
    try {
      if (write) db.unwrapped.exec('BEGIN');
      const p = o.params == null ? [] : Array.isArray(o.params) ? o.params : [o.params];
      plan = db.unwrapped.prepare('EXPLAIN (ANALYZE, BUFFERS) ' + sql).all(...p).map(r => r['QUERY PLAN']).join('\n');
    } catch (e) { plan = 'EXPLAIN failed: ' + String(e.message).split('\n')[0].slice(0, 200); }
    finally { if (write) { try { db.unwrapped.exec('ROLLBACK'); } catch (e) { /* */ } } }
    out.push({ sql: sq(sql), ms: Math.round(o.ms), rows: o.rows, room: o.room, plan: plan.slice(0, 4000) });
  }
  return out;
}

async function walk(dir) {
  if (PG) hookPg(); else hook();
  const crypto = require('crypto');
  const { createApp } = require(path.join(ROOT, 'src/app'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: SECRET, noTimers: true });
  const { db } = app.locals; const V = require(path.join(ROOT, 'src/views'));
  const http = require('http');
  const srv = http.createServer((req, res) => app(req, res)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
  const makerCookie = m => { const exp = String(Date.now() + 864e5); return `wm_m=${m.id}.${exp}.${sign(`m${m.id}.${exp}${m.sess ? '.' + m.sess : ''}`)}`; };
  const buyerCookie = b => `wm_b=${b.id}.${sign('b' + b.id + (b.sess ? '.' + b.sess : ''))}`;
  const one = sql => db.prepare(sql).get();
  const mk = one("SELECT * FROM makers WHERE handle='mk'"), museum = one("SELECT * FROM makers WHERE handle='museum-a'");
  const mkb = one(`SELECT * FROM buyers WHERE id=${mk.buyer_id}`);
  // the Studio's cookie, by its own door
  const r0 = await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'password=pw' });
  const studio = (r0.headers.getSetCookie() || []).map(c => c.split(';')[0]).filter(c => /^wm_s=/.test(c)).join('; ');
  if (!studio) { console.error('big-house: the Studio would not sign in (' + r0.status + ')'); process.exit(1); }
  const rooms = g => g.flatMap(([, l]) => l.map(x => x[0]));
  const w = sql => (one(sql) || {}).slug;
  const mkSlug = V.makerSlug ? V.makerSlug(mk) : mk.handle;
  const extra = [
    `/w/${w("SELECT slug FROM works WHERE maker_id=" + museum.id + " AND status='held' AND vol_page IS NULL ORDER BY id DESC LIMIT 1")}`, `/w/${w('SELECT slug FROM works WHERE maker_id=' + mk.id + ' ORDER BY id LIMIT 1')}`,
    `/m/${mkSlug}`, `/m/${V.makerSlug ? V.makerSlug(museum) : museum.handle}`, '/art/artist-7', '/rooms/room-3', '/d/album1', '/volume/codex-big', '/volume/codex-small',
    '/read/notes-book', '/read/notes-book?c=3', '/read/text-1', '/library', '/ledger', '/find?q=river', '/api/find?q=paris', '/api/stroll?n=8', '/api/v1/works?limit=24&offset=5000', '/api/index.json', '/house', '/makers', '/', '/healthz',
    `/c/${w("SELECT ref AS slug FROM licenses WHERE status='active' ORDER BY id LIMIT 1")}`,
    // (#179) Search as people ask: a title by its maker, a place and a year, a decade, a phrase, a kind, a holder, a
    // number typed exactly, a word nothing carries beside words that are, words never carried together, a slip, and
    // Wander by the same words. Each is a visitor's path: no statement over the line, no walk of the collection.
    ...['the harbour by maker 12', 'paris 1962', 'study of a river 1960s', '"still life with lemons" kyoto', 'photographs in lisbon', 'artist 7 at museum a', 'BH.4242', 'WM-2026-000001', 'window in kyoto xyzzyq', 'kyoto zzzzqq blorp', 'vienna 1066', 'harbuor lisbon', 'zzzzqq'].map(q => `/api/find?q=${encodeURIComponent(q)}`),
    `/find?q=${encodeURIComponent('the harbour by maker 12 xyzzyq')}`, '/find?q=zzzzqq+blorp', `/api/stroll?n=8&q=${encodeURIComponent('the harbour by maker 12')}`, `/api/stroll?n=8&q=${encodeURIComponent('paris 1960s')}`, `/wander?q=${encodeURIComponent('street evening in rome')}`,
  ];
  const people = [
    ['visitor', '', [...rooms(V.DOORS), ...extra]],
    ['maker', `${makerCookie(mk)}; ${buyerCookie(mkb)}`, [...rooms(V.ROOMS.maker), ...rooms(V.ROOMS.yours), '/account/table?all=1']],
    ['museum', makerCookie(museum), [...rooms(V.ROOMS.institution), ...rooms(V.ROOMS.maker)]],
    // (#116) the numbers desk at every span, its json door and the digest, and the full /healthz
    ['studio', studio, [...rooms(V.ROOMS.house), ...rooms(V.ROOMS.maker), '/studio/trove?sort=unfinished', `/studio/volumes?show=open&pages=${one("SELECT id FROM volumes WHERE slug='codex-big'").id}`, '/volume/codex-big',
      '/studio/analytics?span=7d', '/studio/analytics?span=30d', '/studio/analytics.json?span=30d', '/studio/digest', '/healthz']],
  ];
  const out = [];
  for (const [who, cookie, list] of people) {
    for (const p of [...new Set(list)]) {
      if (/logout|signout/.test(p) || (process.env.BIG_ONLY && !new RegExp(process.env.BIG_ONLY).test(`${who} ${p}`))) continue;
      const rec = { who, room: p, n: 0, dbMs: 0, slow: { ms: 0, sql: '' }, most: { rows: 0, sql: '' }, read: 0, big: { bytes: 0, sql: '' }, over: [], by: new Map(), status: 0, ms: 0, bytes: 0 };
      cur = rec; const t = Date.now(); const rss0 = process.memoryUsage().rss;
      try {
        const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(120000), headers: { cookie, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Macintosh) big-house' } });
        const buf = Buffer.from(await r.arrayBuffer()); rec.status = r.status; rec.bytes = buf.length; if (r.status >= 300 && r.status < 400) rec.to = r.headers.get('location');
        // A 500 names its fault (the house keeps its last one), so the annotation says what broke and not only that it did.
        if (r.status >= 500 && app.locals.lastFault) rec.err = `${app.locals.lastFault.message} ${String(app.locals.lastFault.stack || '').split('\n').slice(1, 3).join(' | ')}`.slice(0, 400);
      } catch (e) { rec.status = 'error'; rec.err = String(e.message).slice(0, 120); }
      rec.ms = Date.now() - t; rec.rssMB = Math.round((process.memoryUsage().rss - rss0) / 1048576);
      await new Promise(r => setImmediate(r)); cur = null; // what a page left on the loop is its own
      rec.dbMs = Math.round(rec.dbMs); rec.slow.ms = Math.round(rec.slow.ms * 10) / 10; rec.slow.sql = sq(rec.slow.sql); rec.most.sql = sq(rec.most.sql); rec.big.sql = sq(rec.big.sql);
      { let top = null; for (const [q, v] of rec.by) if (!top || v.n > top.n) top = { n: v.n, ms: Math.round(v.ms), sql: sq(q) }; rec.rep = top || { n: 0, ms: 0, sql: '' }; rec.sum = [...rec.by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([q, v]) => ({ n: v.n, ms: Math.round(v.ms), sql: sq(q) })); delete rec.by; }
      rec.over = rec.over.sort((a, b) => b.ms - a.ms).slice(0, 5).map(o => ({ ms: Math.round(o.ms), rows: o.rows, sql: sq(o.sql) }));
      if (!rec.gone && !fs.existsSync(dir)) { rec.gone = true; console.error('[big-house] the house folder vanished after ' + who + ' ' + p); }
      out.push(rec);
    }
  }
  srv.close();
  if (PG) { const t = Date.now(); fs.writeFileSync(dir + '.plans.json', JSON.stringify(explainAll(db))); console.error(`[big-house] plans asked in ${Date.now() - t} ms`); }
  fs.writeFileSync(dir + '.walk.json', JSON.stringify(out));
  process.exit(0);
}
const sq = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400);

// ---------------------------------------------------------------------------------------------------------------- judge
function judge(rows, ALLOW_ = ALLOW) {
  const ALLOW = ALLOW_; const faults = [], allowed = [], hit = new Set();
  const key = r => `${r.who} ${r.room}`;
  const allowFor = (r, budget, sql) => ALLOW.find((a, i) => { const ok = (a.room === key(r) || a.room === '*') && a.budget === budget && (!a.sql || String(sql || '').includes(a.sql)); if (ok) hit.add(i); return ok; });
  const check = (r, budget, value, line, sql) => {
    if (value <= line) return;
    const a = allowFor(r, budget, sql);
    const what = `${key(r)}: ${budget} ${Math.round(value).toLocaleString()} over ${line.toLocaleString()}${sql ? ` · ${sql.slice(0, 220)}` : ''}`;
    if (a && value <= a.max) allowed.push(`${what} (allowed to ${a.max.toLocaleString()}, #${a.issue})`);
    else faults.push(a ? `${what} — over its allowance of ${a.max.toLocaleString()} (#${a.issue})` : what);
  };
  for (const r of rows) {
    if (r.status === 'error' || r.status >= 500) faults.push(`${key(r)}: answered ${r.status}${r.err ? ' ' + r.err : ''}`);
    check(r, 'pageMs', r.ms, B.pageMs, r.slow.sql);
    check(r, 'bytes', r.bytes, B.bytes);
    check(r, 'stmts', r.n, B.stmts, r.rep && r.rep.n > 1 ? `${r.rep.n} times: ${r.rep.sql}` : '');
    check(r, 'stmtMs', r.slow.ms, B.stmtMs, r.slow.sql);
    check(r, 'rows', r.most.rows, B.rows, r.most.sql);
    if (r.read != null) check(r, 'read', r.read, B.read, r.big && r.big.sql ? `largest ${Math.round(r.big.bytes / 1024).toLocaleString()} KB: ${r.big.sql}` : '');
  }
  // a count line that matched nothing is a room now within that budget (a time line may sit under its line on a fast run)
  const stale = ALLOW.filter((a, i) => !hit.has(i) && !/Ms$/.test(a.budget)).map(a => `${a.room} ${a.budget} (#${a.issue})`);
  return { faults, allowed, stale };
}

function table(rows, md) {
  const kb = b => (b / 1024).toFixed(0);
  if (md) {
    const h = '| person | room | status | ms | statements | db ms | slowest ms | slowest statement | most rows | KB | read KB | asked most |\n|---|---|---|--:|--:|--:|--:|---|--:|--:|--:|---|\n';
    return h + rows.map(r => `| ${r.who} | \`${r.room}\` | ${r.status}${r.to ? ' → ' + r.to.slice(0, 40) : ''} | ${r.ms} | ${r.n} | ${r.dbMs} | ${r.slow.ms} | ${r.slow.ms >= 5 ? '`' + r.slow.sql.slice(0, 120).replace(/\|/g, '/') + '`' : ''} | ${r.most.rows} | ${kb(r.bytes)} | ${kb(r.read || 0)} | ${r.rep && r.rep.n > 20 ? r.rep.n + ' × `' + r.rep.sql.slice(0, 80).replace(/\|/g, '/') + '`' : ''} |`).join('\n') + '\n';
  }
  return rows.map(r => `${r.who.padEnd(8)} ${r.room.slice(0, 44).padEnd(44)} ${String(r.status).padStart(4)} ${String(r.ms).padStart(6)} ms ${String(r.n).padStart(4)} st ${String(r.slow.ms).padStart(7)} ms ${String(r.most.rows).padStart(6)} rows ${kb(r.bytes).padStart(6)} KB ${kb(r.read || 0).padStart(7)} KB read`).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------- gate
const TITLE = process.env.BIG_PG ? 'scale-postgres' : 'scale';
function annotate(title, body) { if (process.env.GITHUB_ACTIONS) console.log(`::error title=${title}::${String(body).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`); }
function child(mode, dir, env, args = []) {
  const file = mode === 'move' ? path.join(ROOT, 'scripts/to-postgres.js') : __filename;
  const r = spawnSync(process.execPath, mode === 'move' ? [file, ...args] : [file, mode, dir], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { const tail = ((r.stdout || '') + (r.stderr || '')).slice(-1400); console.log(`big-house: ${mode} failed (exit ${r.status}${r.signal ? ', ' + r.signal : ''})\n${tail}`); annotate(`${TITLE} (${mode})`, `the ${mode} step failed (exit ${r.status}${r.signal ? ', ' + r.signal : ''}):\n${tail}`); process.exit(1); }
  if (mode === 'move') return { out: r.stdout };
  const said = String(r.stdout).split('@@').pop();
  try { return JSON.parse(said.trim().split('\n')[0]); } catch (e) { return {}; }
}
// (#116) A statement on the Postgres server outside any house (make or drop the walk's database, VACUUM), synchronously,
// in a child, so it can run in an exit handler too.
const PGJS = `const { Client } = require('pg'); const c = new Client({ connectionString: process.argv[1] }); c.connect().then(() => c.query(process.argv[2])).then(() => c.end()).then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });`;
function pgAdmin(url, sql) {
  const r = spawnSync(process.execPath, ['-e', PGJS, url, sql], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { const why = `${sql.slice(0, 60)}: ${(r.stderr || '').trim().slice(0, 300)}`; console.log('big-house: the Postgres server refused ' + why); annotate(`${TITLE} (server)`, why); process.exit(1); }
}
const withDb = (url, name) => { const u = new URL(url); u.pathname = '/' + name; return u.toString(); };
const safeUrl = url => { try { const u = new URL(url); u.password = u.password ? '***' : ''; return u.toString(); } catch (e) { return '(a Postgres url)'; } };

function gate() {
  const again = process.env.BIG_DIR; // a house kept by BIG_KEEP, walked again without building (for a worker's own use)
  const pgServer = process.env.BIG_PG; // (#116) a Postgres server: the house is moved into a fresh database on it and walked through the bridge
  const dir = again || fs.mkdtempSync(path.join(os.tmpdir(), 'wm-big-'));
  let pgUrl = again && pgServer ? process.env.BIG_PG_DB || '' : '';
  const pgName = `wm_big_${process.pid}`;
  if (!process.env.BIG_KEEP && !again) process.on('exit', () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); for (const f of ['.walk.json', '.plans.json']) fs.rmSync(dir + f, { force: true }); fs.rmSync(dir + '-migrate', { recursive: true, force: true }); } catch (e) { /* */ }
    if (pgServer) { const r = spawnSync(process.execPath, ['-e', PGJS, pgServer, `DROP DATABASE IF EXISTS ${pgName} WITH (FORCE)`], { cwd: ROOT, encoding: 'utf8' }); if (r.status !== 0) console.log('big-house: could not drop ' + pgName + ': ' + (r.stderr || '').trim().slice(0, 200)); }
  });
  const quiet = { DB_SLOW_MS: '999999', LOOP_LAG: '0', CHORES: '0', NO_SEED: '', WATCHDOG: '0', MALLOC_ARENA_MAX: '2', DATABASE_URL: '' };
  const t0 = Date.now();
  const b = again ? { ms: 0, lap: {}, sizes: {} } : child('build', dir, { ...quiet, NODE_ENV: 'test' });
  if (!again) console.log(`big-house: built ${N.toLocaleString()} works in ${(b.ms / 1000).toFixed(1)} s, ${b.dbMB} MB on disk (${Object.entries(b.lap || {}).map(([k, v]) => `${k} ${v}`).join(', ')} ms)`);
  if (!again) console.log(`  ${Object.entries(b.sizes || {}).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}`);
  if (pgServer && !again) {
    // The move, as the house moved on 27 Oct: scripts/to-postgres.js into a fresh database, then VACUUM ANALYZE (live's
    // tables are settled by autovacuum; a table just filled has no statistics and plans as if empty).
    const t = Date.now();
    pgAdmin(pgServer, `DROP DATABASE IF EXISTS ${pgName} WITH (FORCE)`); pgAdmin(pgServer, `CREATE DATABASE ${pgName}`);
    pgUrl = withDb(pgServer, pgName);
    // Live (Render's page, 20 Nov) is Postgres 16 on 2 CPU and 8 GB, settings assumed Postgres's defaults (work_mem 4 MB);
    // the gate's server runs its defaults too. BIG_PG_SET (`name=value,…`) sets others on the walk's database to try one.
    for (const kv of String(process.env.BIG_PG_SET || '').split(',').filter(Boolean)) {
      const [k, v] = kv.split('='); if (!/^\w+$/.test(k) || !/^[\w.]+$/.test(v)) throw new Error('BIG_PG_SET: ' + kv);
      pgAdmin(pgServer, `ALTER DATABASE ${pgName} SET ${k} = '${v}'`);
    }
    const m = child('move', dir, { ...quiet, DATABASE_URL: pgUrl, NODE_ENV: 'migrate', DATA_DIR: dir + '-migrate', ROLE: '' }, [path.join(dir, 'watermark.db')]);
    const ok = /^ok: .*$/m.exec(m.out || '');
    const tm = Date.now(); pgAdmin(pgUrl, 'VACUUM ANALYZE');
    console.log(`big-house: moved into Postgres (${safeUrl(pgUrl)}) in ${((tm - t) / 1000).toFixed(1)} s, vacuumed and analysed in ${((Date.now() - tm) / 1000).toFixed(1)} s${ok ? ' · ' + ok[0] : ''}`);
  }
  const db = pgServer ? { DATABASE_URL: pgUrl } : {};
  const wk = again ? {} : child('worker', dir, { ...quiet, ...db, NODE_ENV: 'production', ROLE: 'worker', NO_SEED: '1' });
  if (!again) console.log(`big-house: the worker built ahead in ${wk.ms} ms: ${(wk.built || []).join(', ')}`);
  const t1 = Date.now();
  // The walk is the website as live runs it (ROLE=web, NUMBERS_DESK unset): since #114/#120 the numbers desk, its json
  // and the digest read the report the worker's round above made and kept. BIG_NUMBERS_DESK=1 walks them as the website
  // making its own report (the path that stopped the house on 18 and 20 Nov), to measure that path.
  child('walk', dir, { ...quiet, ...db, NODE_ENV: 'production', ROLE: 'web', NO_SEED: '1', NUMBERS_DESK: process.env.BIG_NUMBERS_DESK || '' });
  const rows = JSON.parse(fs.readFileSync(dir + '.walk.json', 'utf8'));
  const plans = pgServer && fs.existsSync(dir + '.plans.json') ? JSON.parse(fs.readFileSync(dir + '.plans.json', 'utf8')) : [];
  console.log(`big-house: walked ${rows.length} rooms${pgServer ? ' on Postgres through the bridge' : ''} in ${((Date.now() - t1) / 1000).toFixed(1)} s (all told ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (process.env.BIG_TABLE) fs.writeFileSync(process.env.BIG_TABLE, table(rows, true));
  if (process.env.BIG_JSON) fs.writeFileSync(process.env.BIG_JSON, JSON.stringify(rows, null, 1));
  if (process.env.BIG_PLANS) fs.writeFileSync(process.env.BIG_PLANS, plans.map(p => `### ${p.room} · ${p.ms} ms · ${p.rows} rows\n\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n\`\`\`\n${p.plan}\n\`\`\`\n`).join('\n'));
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 25);
  console.log('the slowest rooms:\n' + table(worst));
  const { faults, allowed, stale } = judge(rows, pgServer ? ALLOW_PG : ALLOW);
  if (allowed.length) console.log(`allowed (${allowed.length}, each with its issue):\n  ` + allowed.join('\n  '));
  if (stale.length && !process.env.BIG_ONLY) console.log(`stale allow lines (nothing matched them; delete them): ${stale.join(', ')}`);
  if (plans.length) console.log(`plans of the statements over a line (EXPLAIN ANALYZE after the walk; the worst ${Math.min(plans.length, 5)} here${process.env.BIG_PLANS ? ', all in ' + process.env.BIG_PLANS : ''}):\n` + plans.slice(0, 5).map(p => `  ${p.room} · ${p.ms} ms · ${p.rows} rows · ${p.sql.slice(0, 200)}\n    ${p.plan.split('\n').slice(0, 8).join('\n    ')}`).join('\n'));
  if (process.env.BIG_KEEP) console.log('big-house: kept ' + dir + (pgUrl ? ` and the database ${pgName} (walk it again: BIG_DIR=${dir} BIG_PG=… BIG_PG_DB=<its url>)` : ''));
  if (faults.length) {
    console.log(`big-house: ${faults.length} FAULTS\n  ` + faults.join('\n  '));
    const planOf = f => { const p = plans.find(x => f.includes(x.sql.slice(0, 120))); return p ? `\nplan: ${p.plan.split('\n').slice(0, 6).join('\n')}` : ''; };
    for (const f of faults.slice(0, 20)) annotate(TITLE, f + planOf(f));
    if (faults.length > 20) annotate(TITLE, `${faults.length - 20} more faults: see the log`);
    process.exit(1);
  }
  console.log(`big-house: holds (${rows.length} rooms${pgServer ? ', Postgres' : ''}; statement ${B.stmtMs} ms, rows ${B.rows}, page ${B.pageMs} ms, ${B.bytes / 1048576} MB, ${B.stmts} statements)`);
}

const [mode, dir] = process.argv.slice(2);
if (mode === 'build') build(dir).catch(e => { console.error(e); process.exit(1); });
else if (mode === 'worker') worker(dir);
else if (mode === 'walk') walk(dir).catch(e => { console.error(e); process.exit(1); });
else if (require.main === module) gate();
module.exports = { judge, ALLOW, ALLOW_PG, B };
