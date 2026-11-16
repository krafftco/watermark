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
//    chain), 3,000 artists, 2,000 collectors, 8,000 licences, 300,000 view rows, 50,000 stood, 20,000 notes, notices,
//    40 rooms of 30,000 places, three volumes (one of 945 pages, as Leonardo's), 300 albums, letters, 60,000 hits,
//    150 texts and a book of 1,566 numbered notes (the reader's whole-book page). Deterministic: no random numbers;
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
//    A known heavy room is in ALLOW below: the room, the budget, what it measured, why, and its issue. It passes on that
//    budget alone, up to its ceiling (`max`); anything new on it, or over the ceiling, fails. An allow line that no
//    longer matches anything is printed as stale (delete it).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const N = +process.env.BIG_WORKS || 100000, MK = +process.env.BIG_MAKERS || 300, SEED = +process.env.BIG_SEED || 6;
const B = {
  stmtMs: +process.env.BIG_STMT_MS || 250, rows: +process.env.BIG_ROWS || 5000, pageMs: +process.env.BIG_PAGE_MS || 1500,
  bytes: +process.env.BIG_BYTES || 3 * 1024 * 1024, stmts: +process.env.BIG_STMTS || 300,
};
const SECRET = 'big-house';

// The allow-list: rooms known to be over a budget, each with its issue. `room` is the room as the table names it
// (`person room`, or '*' for a statement allowed wherever it lands, which then needs `sql`), `budget` one of stmtMs rows pageMs bytes stmts, `max` the ceiling it may reach (a little above what
// was measured, so it cannot quietly grow), `sql` (optional) a fragment the offending statement must contain.
const ALLOW = [
  // 16 Nov, the first measurement (#8): every room over a budget at 100,000 works, each with the issue that takes it out.
  // Counts (rows, bytes, statements) are allowed to a quarter above what was measured; times to three times it (CI's
  // runner is slower and shared), and a time is listed when it reached half its line, so a slow run does not flake.
  // Wander's pools (a maker's works, read to choose from) are kept two minutes, so which room builds one depends on the
  // walk's timing: that statement is allowed in any room ('*'), by its text.
  { room: '*', budget: 'rows', max: 75000, sql: "FROM works WHERE maker_id=? AND status IN ('held','hidden') AND taken_at IS NOT NULL", issue: 70 }, // measured 60,000 (/wander), 25,000 (/, /api/stroll)
  { room: 'visitor /art', budget: 'stmts', max: 3700, issue: 71 }, // measured 2,943
  { room: 'visitor /collection', budget: 'rows', max: 125000, issue: 72 }, // measured 100,000
  { room: 'visitor /kids', budget: 'rows', max: 42500, issue: 73 }, // measured 33,998
  { room: 'visitor /vr', budget: 'stmtMs', max: 550, issue: 74 }, // measured 177
  { room: 'visitor /vr', budget: 'rows', max: 117100, issue: 74 }, // measured 93,650
  { room: 'visitor /keys', budget: 'rows', max: 42500, issue: 73 }, // measured 33,998
  { room: 'visitor /trade', budget: 'stmts', max: 500, issue: 75 }, // measured 360
  { room: 'visitor /trade', budget: 'rows', max: 7500, issue: 75 }, // measured 6,000
  { room: 'visitor /m/museum-a', budget: 'stmtMs', max: 1100, issue: 76 }, // measured 362
  { room: 'visitor /m/museum-a', budget: 'rows', max: 75000, issue: 76 }, // measured 60,000
  { room: 'visitor /api/index.json', budget: 'rows', max: 37500, issue: 77 }, // measured 30,000
  { room: 'maker /wander', budget: 'stmtMs', max: 500, issue: 70 }, // measured 159
  { room: 'maker /wander', budget: 'rows', max: 117100, issue: 70 }, // measured 93,650
  { room: 'museum /account/held', budget: 'rows', max: 37600, issue: 79 }, // measured 30,004
  { room: 'museum /account/hang', budget: 'rows', max: 26300, issue: 82 }, // measured 21,000
  { room: 'studio /studio/trove', budget: 'rows', max: 25000, issue: 86 }, // measured 20,000
  { room: 'studio /studio/licenses', budget: 'pageMs', max: 3050, issue: 87 }, // measured 1,011
  { room: 'studio /studio/licenses', budget: 'bytes', max: 4400000, issue: 87 }, // measured 3,489,937
  { room: 'studio /studio/licenses', budget: 'rows', max: 10000, issue: 87 }, // measured 8,000
  { room: 'studio /studio/accounts', budget: 'stmts', max: 2700, issue: 90 }, // measured 2,085
  { room: 'studio /studio/books', budget: 'stmts', max: 12200, issue: 93 }, // measured 9,745
  { room: 'studio /studio/trove?sort=unfinished', budget: 'rows', max: 25000, issue: 86 }, // measured 20,000
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
      step('views', () => db.exec(R(300000, `INSERT INTO views (work_id, host, kind, day, count) SELECT ${lo.a} + (g % ${W}), 'watermark', 'view', date('now', '-' || (g / ${W} * 29 + g % 29) || ' day'), 1 + (g % 9) FROM s`)));
      step('stood', () => db.exec(R(50000, `INSERT INTO stood (work_id, viewer, buyer_id, n, at, seconds, visits, last_at) SELECT ${wk('g * 104729')}, 'v' || (g % 9000), CASE WHEN g % 5 = 0 THEN ${b0} + (g % 2000) ELSE NULL END, 1, datetime('now', '-' || (g % 60) || ' day'), 5 + (g % 120), 1 + (g % 3), datetime('now', '-' || (g % 60) || ' day') FROM s`)));
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
      step('hits', () => db.exec(R(60000, "INSERT INTO hits (at, path, kind, status, ms, visitor, device, browser, bot, bytes) SELECT datetime('now', '-' || (g % 43200) || ' minute'), CASE g % 4 WHEN 0 THEN '/wander' WHEN 1 THEN '/w/bh-' || g WHEN 2 THEN '/' ELSE '/look' END, 'page', 200, 20 + (g % 300), 'v' || (g % 9000), 'phone', 'safari', 0, 20000 FROM s")));
      step('texts', () => {
        db.exec(R(150, `INSERT INTO texts (slug, kind, title, author, maker_id, body, public, status, created_at, updated_at) SELECT 'text-' || g, CASE WHEN g % 3 = 0 THEN 'essay' ELSE 'book' END, 'A text ' || g, 'Author ' || g, CASE WHEN g % 10 = 0 THEN ${M} ELSE ${house} END, '## One\n\n' || 'A paragraph of the text, plain and short. ' || g || '\n\n## Two\n\nAnother.', 1, 'held', datetime('now'), datetime('now') FROM s`));
        db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES ('notes-book', 'book', 'A Book of Notes', 'An author of the past', ?, 1, 'held', 'https://example.org/notes', 'Public domain.')").run(notesBook());
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
    const sizes = Object.fromEntries(['makers', 'works', 'artists', 'buyers', 'licenses', 'views', 'stood', 'notes', 'notices', 'collection_works', 'volume_pages', 'deliveries', 'delivery_works', 'letters', 'hits', 'texts', 'ledger'].map(t => [t, count(t)]));
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
  console.log('@@' + JSON.stringify({ ms: Date.now() - t, built }));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------- walk
// Every statement SQLite runs, timed and given to the request in flight (the walk asks one room at a time).
let cur = null;
function hook() {
  const Database = require('better-sqlite3');
  const mem = new Database(':memory:'); const P = Object.getPrototypeOf(mem.prepare('SELECT 1')); mem.close();
  const note = (sql, ms, rows) => {
    if (!cur) return; cur.n++; cur.dbMs += ms;
    const k = cur.by.get(sql) || { n: 0, ms: 0 }; k.n++; k.ms += ms; cur.by.set(sql, k);
    if (ms > cur.slow.ms) cur.slow = { ms, sql };
    if (rows > cur.most.rows) cur.most = { rows, sql };
    if (ms > B.stmtMs || rows > B.rows) cur.over.push({ ms, rows, sql });
  };
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  for (const m of ['run', 'get', 'all']) {
    const o = P[m];
    P[m] = function (...a) {
      if (!cur) return o.apply(this, a);
      const t = now(); const r = o.apply(this, a); const ms = now() - t;
      note(this.source, ms, m === 'all' ? r.length : m === 'get' ? (r === undefined ? 0 : 1) : 0); return r;
    };
  }
  const oi = P.iterate;
  P.iterate = function (...a) {
    if (!cur) return oi.apply(this, a);
    const sql = this.source; let t = now(); const it = oi.apply(this, a); let ms = now() - t, rows = 0; const rec = cur;
    return { [Symbol.iterator]() { return this; }, next() { const t1 = now(); const r = it.next(); ms += now() - t1; if (r.done) { const c = cur; cur = rec; note(sql, ms, rows); cur = c; } else rows++; return r; }, return(v) { const c = cur; cur = rec; note(sql, ms, rows); cur = c; return it.return ? it.return(v) : { done: true, value: v }; } };
  };
  const oe = Database.prototype.exec;
  Database.prototype.exec = function (sql) { if (!cur) return oe.call(this, sql); const t = now(); const r = oe.call(this, sql); note(sql, now() - t, 0); return r; };
}

async function walk(dir) {
  hook();
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
    '/read/notes-book', '/read/notes-book?c=3', '/read/text-1', '/library', '/ledger', '/find?q=river', '/api/find?q=paris', '/api/stroll?n=8', '/api/v1/works?limit=24&offset=5000', '/api/index.json', '/house', '/makers', '/',
    `/c/${w("SELECT ref AS slug FROM licenses WHERE status='active' ORDER BY id LIMIT 1")}`,
  ];
  const people = [
    ['visitor', '', [...rooms(V.DOORS), ...extra]],
    ['maker', `${makerCookie(mk)}; ${buyerCookie(mkb)}`, [...rooms(V.ROOMS.maker), ...rooms(V.ROOMS.yours), '/account/table?all=1']],
    ['museum', makerCookie(museum), [...rooms(V.ROOMS.institution), ...rooms(V.ROOMS.maker)]],
    ['studio', studio, [...rooms(V.ROOMS.house), ...rooms(V.ROOMS.maker), '/studio/trove?sort=unfinished', `/studio/volumes?show=open&pages=${one("SELECT id FROM volumes WHERE slug='codex-big'").id}`, '/volume/codex-big']],
  ];
  const out = [];
  for (const [who, cookie, list] of people) {
    for (const p of [...new Set(list)]) {
      if (/logout|signout/.test(p) || (process.env.BIG_ONLY && !new RegExp(process.env.BIG_ONLY).test(`${who} ${p}`))) continue;
      const rec = { who, room: p, n: 0, dbMs: 0, slow: { ms: 0, sql: '' }, most: { rows: 0, sql: '' }, over: [], by: new Map(), status: 0, ms: 0, bytes: 0 };
      cur = rec; const t = Date.now();
      try {
        const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(120000), headers: { cookie, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Macintosh) big-house' } });
        const buf = Buffer.from(await r.arrayBuffer()); rec.status = r.status; rec.bytes = buf.length; if (r.status >= 300 && r.status < 400) rec.to = r.headers.get('location');
      } catch (e) { rec.status = 'error'; rec.err = String(e.message).slice(0, 120); }
      rec.ms = Date.now() - t;
      await new Promise(r => setImmediate(r)); cur = null; // what a page left on the loop is its own
      rec.dbMs = Math.round(rec.dbMs); rec.slow.ms = Math.round(rec.slow.ms * 10) / 10; rec.slow.sql = sq(rec.slow.sql); rec.most.sql = sq(rec.most.sql);
      { let top = null; for (const [q, v] of rec.by) if (!top || v.n > top.n) top = { n: v.n, ms: Math.round(v.ms), sql: sq(q) }; rec.rep = top || { n: 0, ms: 0, sql: '' }; rec.sum = [...rec.by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([q, v]) => ({ n: v.n, ms: Math.round(v.ms), sql: sq(q) })); delete rec.by; }
      rec.over = rec.over.sort((a, b) => b.ms - a.ms).slice(0, 5).map(o => ({ ms: Math.round(o.ms), rows: o.rows, sql: sq(o.sql) }));
      if (!rec.gone && !fs.existsSync(dir)) { rec.gone = true; console.error('[big-house] the house folder vanished after ' + who + ' ' + p); }
      out.push(rec);
    }
  }
  fs.writeFileSync(dir + '.walk.json', JSON.stringify(out));
  srv.close(); process.exit(0);
}
const sq = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400);

// ---------------------------------------------------------------------------------------------------------------- judge
function judge(rows) {
  const faults = [], allowed = [], hit = new Set();
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
  }
  // a count line that matched nothing is a room now within that budget (a time line may sit under its line on a fast run)
  const stale = ALLOW.filter((a, i) => !hit.has(i) && !/Ms$/.test(a.budget)).map(a => `${a.room} ${a.budget} (#${a.issue})`);
  return { faults, allowed, stale };
}

function table(rows, md) {
  const kb = b => (b / 1024).toFixed(0);
  if (md) {
    const h = '| person | room | status | ms | statements | db ms | slowest ms | slowest statement | most rows | KB | asked most |\n|---|---|---|--:|--:|--:|--:|---|--:|--:|---|\n';
    return h + rows.map(r => `| ${r.who} | \`${r.room}\` | ${r.status}${r.to ? ' → ' + r.to.slice(0, 40) : ''} | ${r.ms} | ${r.n} | ${r.dbMs} | ${r.slow.ms} | ${r.slow.ms >= 5 ? '`' + r.slow.sql.slice(0, 120).replace(/\|/g, '/') + '`' : ''} | ${r.most.rows} | ${kb(r.bytes)} | ${r.rep && r.rep.n > 20 ? r.rep.n + ' × `' + r.rep.sql.slice(0, 80).replace(/\|/g, '/') + '`' : ''} |`).join('\n') + '\n';
  }
  return rows.map(r => `${r.who.padEnd(8)} ${r.room.slice(0, 44).padEnd(44)} ${String(r.status).padStart(4)} ${String(r.ms).padStart(6)} ms ${String(r.n).padStart(4)} st ${String(r.slow.ms).padStart(7)} ms ${String(r.most.rows).padStart(6)} rows ${kb(r.bytes).padStart(6)} KB`).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------- gate
function annotate(title, body) { if (process.env.GITHUB_ACTIONS) console.log(`::error title=${title}::${String(body).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`); }
function child(mode, dir, env) {
  const r = spawnSync(process.execPath, [__filename, mode, dir], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { const tail = ((r.stdout || '') + (r.stderr || '')).slice(-1400); console.log(`big-house: ${mode} failed (exit ${r.status})\n${tail}`); annotate(`scale (${mode})`, `the ${mode} step failed (exit ${r.status}):\n${tail}`); process.exit(1); }
  const said = String(r.stdout).split('@@').pop();
  try { return JSON.parse(said.trim().split('\n')[0]); } catch (e) { return {}; }
}
function gate() {
  const again = process.env.BIG_DIR; // a house kept by BIG_KEEP, walked again without building (for a worker's own use)
  const dir = again || fs.mkdtempSync(path.join(os.tmpdir(), 'wm-big-'));
  if (!process.env.BIG_KEEP && !again) process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir + '.walk.json', { force: true }); } catch (e) { /* */ } });
  const quiet = { DB_SLOW_MS: '999999', LOOP_LAG: '0', CHORES: '0', NO_SEED: '', WATCHDOG: '0', MALLOC_ARENA_MAX: '2', DATABASE_URL: '' };
  const t0 = Date.now();
  const b = again ? { ms: 0, lap: {}, sizes: {} } : child('build', dir, { ...quiet, NODE_ENV: 'test' });
  if (!again) console.log(`big-house: built in ${(b.ms / 1000).toFixed(1)} s, ${b.dbMB} MB on disk (${Object.entries(b.lap || {}).map(([k, v]) => `${k} ${v}`).join(', ')} ms)`);
  if (!again) console.log(`  ${Object.entries(b.sizes || {}).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}`);
  const wk = again ? {} : child('worker', dir, { ...quiet, NODE_ENV: 'production', ROLE: 'worker', NO_SEED: '1' });
  if (!again) console.log(`big-house: the worker built ahead in ${wk.ms} ms: ${(wk.built || []).join(', ')}`);
  const t1 = Date.now();
  child('walk', dir, { ...quiet, NODE_ENV: 'production', ROLE: 'web', NO_SEED: '1' });
  const rows = JSON.parse(fs.readFileSync(dir + '.walk.json', 'utf8'));
  console.log(`big-house: walked ${rows.length} rooms in ${((Date.now() - t1) / 1000).toFixed(1)} s (all told ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (process.env.BIG_TABLE) fs.writeFileSync(process.env.BIG_TABLE, table(rows, true));
  if (process.env.BIG_JSON) fs.writeFileSync(process.env.BIG_JSON, JSON.stringify(rows, null, 1));
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 25);
  console.log('the slowest rooms:\n' + table(worst));
  const { faults, allowed, stale } = judge(rows);
  if (allowed.length) console.log(`allowed (${allowed.length}, each with its issue):\n  ` + allowed.join('\n  '));
  if (stale.length && !process.env.BIG_ONLY) console.log(`stale allow lines (nothing matched them; delete them): ${stale.join(', ')}`);
  if (faults.length) {
    console.log(`big-house: ${faults.length} FAULTS\n  ` + faults.join('\n  '));
    for (const f of faults.slice(0, 20)) annotate('scale', f);
    if (faults.length > 20) annotate('scale', `${faults.length - 20} more faults: see the log`);
    process.exit(1);
  }
  console.log(`big-house: holds (${rows.length} rooms; statement ${B.stmtMs} ms, rows ${B.rows}, page ${B.pageMs} ms, ${B.bytes / 1048576} MB, ${B.stmts} statements)`);
  if (process.env.BIG_KEEP) console.log('big-house: kept ' + dir);
}

const [mode, dir] = process.argv.slice(2);
if (mode === 'build') build(dir).catch(e => { console.error(e); process.exit(1); });
else if (mode === 'worker') worker(dir);
else if (mode === 'walk') walk(dir).catch(e => { console.error(e); process.exit(1); });
else if (require.main === module) gate();
module.exports = { judge, ALLOW, B };
