// A maker's working papers (#182): the inventory, a price list, a consignment sheet, a checklist, the wall labels and
// the exhibition history, printed from the record the house already holds. Walked as a maker; each paper is the
// signed-in maker's own; no price comes from the house; the consignment sheet says it is not legal advice.
//   node test/papers.js                 the papers, by their pages (no browser needed)
//   PAPERS_PRINT=1 node test/papers.js  also prints each paper in a browser (CI's a11y job; a missing browser fails)
//   PAPERS_OUT=<dir>                    keeps the printed PDFs there
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ppr-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ppr', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p, o = {}, j) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, accept: 'text/html', cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) j[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  const form = b => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  const page = async (p, j = {}) => (await go(p, {}, j)).text();
  const main = t => (t.match(/<main[\s\S]*<\/main>/) || [''])[0];
  const text = t => main(t).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

  // Two makers. Pia is the one who prints; Otto is the other, who must never see her record.
  const mkMaker = async (handle, name) => { const j = {}; await go('/studio/login', form({ password: 'pw' }), j);
    db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES (?,?,?,'maker',datetime('now'),'house')").run(handle, name, `${handle}@example.com`);
    const id = db.prepare('SELECT id FROM makers WHERE handle=?').get(handle).id;
    db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) SELECT ?,key,name,description,term_months,kind,sort,price_cents FROM uses WHERE maker_id=(SELECT MIN(id) FROM makers)').run(id);
    await go(`/account?maker=${handle}`, {}, j); return { j, id }; };
  const pia = await mkMaker('ph', 'Pia Hart'), otto = await mkMaker('ot', 'Otto Rey');
  const put = async (who, n) => { const buf = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: (37 * n) % 255, g: 90, b: (120 + 11 * n) % 255 } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `p${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd, headers: { accept: 'application/json' } }, who.j)).json(); return j.slug; };
  const [a, b, c, d] = [await put(pia, 1), await put(pia, 2), await put(pia, 3), await put(pia, 4)];
  const o1 = await put(otto, 9);
  const W = s => db.prepare('SELECT * FROM works WHERE slug=?').get(s);
  db.prepare("UPDATE works SET status='held', width=6000, height=7500 WHERE maker_id IN (?,?)").run(pia.id, otto.id);
  const title = (s, t, y) => db.prepare('UPDATE works SET title=?, taken_at=? WHERE slug=?').run(t, `${y}-05-01`, s);
  title(a, 'Harbour, Morning', 2021); title(b, 'The Long Table', 2022); title(c, 'Winter Field', 2023); title(d, '=Kept Aside', 2024); title(o1, 'Otto’s Secret Study', 2020);
  db.prepare("UPDATE works SET status='hidden' WHERE slug=?").run(d);
  // The object record, through its own door on the work's desk.
  let r = await go(`/account/works/${a}/object`, form({ kind: 'painting', medium: 'oil on linen', dims: '61 × 46 cm', edition: 'unique', signed: 'signed lower right', condition: 'excellent', located: 'Studio, rack 3', note: '' }), pia.j);
  assert.ok(r.status === 303, 'the object record is kept');
  // Picks (the Library's flag), the print sizes with the maker's own prices, a collected piece, a place, a loan, a hang.
  db.prepare("UPDATE works SET flag='pick' WHERE slug IN (?,?)").run(a, b);
  db.prepare("INSERT INTO print_editions (work_id, label, long_in, paper, edition_n, price_cents, framed_cents, active, sort) VALUES (?, '16 × 24', 24, 'Photo Rag', 12, 65000, 30000, 1, 0)").run(W(b).id);
  const social = db.prepare("SELECT id FROM uses WHERE maker_id=? AND key='social'").get(pia.id).id;
  db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, collector_no) VALUES ('WM-2026-700001', ?, ?, 'Named Collector', 'nc@example.com', 700, 'active', datetime('now'), 1)").run(W(b).id, social);
  const year = new Date().getUTCFullYear();
  r = await go(`/account/works/${a}/onview`, form({ do: 'save', venue: 'Galerie Nord', street: '12 Hudson Street', city: 'New York', country: 'United States', opens_on: `${year - 1}-01-10`, until_on: `${year + 1}-03-14`, afterwards: 'history' }), pia.j);
  assert.ok(/ov=ok/.test(r.headers.get('location') || ''), 'a place stated on the work');
  r = await go(`/account/works/${c}/onview`, form({ do: 'save', venue: 'Vanished Rooms', city: 'Lisbon', country: 'Portugal', opens_on: `${year - 3}-01-10`, until_on: `${year - 3}-02-10`, afterwards: 'gone' }), pia.j);
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mus','Museum of the Coast','mus@example.com','institution',datetime('now'),'house')").run();
  db.prepare("INSERT INTO loans (ref, work_id, lender_id, borrower_id, show_title, venue, city, opens, closes, status) VALUES ('LN-1', ?, ?, (SELECT id FROM makers WHERE handle='mus'), 'Light and Water', 'Museum of the Coast', 'Portland', ?, ?, 'home')").run(W(b).id, pia.id, `${year - 2}-04-01`, `${year - 2}-09-01`);
  db.prepare("INSERT INTO buyers (customer, email, name, code, public) VALUES ('', 'ph@example.com', 'Pia Hart', 'phcode', 1)").run();
  const bid = db.prepare("SELECT id FROM buyers WHERE code='phcode'").get().id;
  db.prepare("INSERT INTO hangs (buyer_id, slug, title, public) VALUES (?, 'rooms', 'Rooms', 0)").run(bid); const hid = db.prepare("SELECT id FROM hangs WHERE slug='rooms'").get().id;
  [c, a, o1].forEach((s, i) => db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,?)').run(hid, W(s).id, i));
  pia.j.wm_b = app.locals.setBuyer ? (() => { const res = { cookie: (k, v) => { res.v = v; } }; app.locals.setBuyer(res, db.prepare('SELECT * FROM buyers WHERE id=?').get(bid)); return encodeURIComponent(res.v); })() : '';

  const PAPERS = ['/account/table/inventory', '/account/table/prices', '/account/table/consignment', '/account/table/checklist', '/account/table/exhibitions'];
  // The words no paper carries: the house's technical ones, and everything the issue discards.
  const NEVER = /blockchain|ledger|\btoken|\bhash|\bnft\b|suggest(?!s no price)|recommend|we think|worth\b|apprais|estimate|calculator|discount|rating|testimonial|badge|upgrade|premium|per month|invoice/i;

  // 1. Signed out: a person is shown the way in, never a bare status; the CSV too.
  for (const p of [...PAPERS, '/account/table/inventory.csv']) { r = await go(p, {}, {}); assert.ok(r.status === 302 && /^\/signin\?next=/.test(r.headers.get('location') || ''), `${p}: signed out, the way in`); }

  // 2. The inventory: what it is, where it is, how many hold a piece, where it has been shown; the maker's own alone.
  let t = await page('/account/table/inventory', pia.j), m = text(t);
  for (const s of ['Harbour, Morning', 'The Long Table', 'Winter Field', 'Kept Aside', 'Painting, oil on linen', '61 × 46 cm', 'unique', 'Studio, rack 3', 'Galerie Nord, New York', 'Light and Water', 'Museum of the Coast, Portland', 'Kept back', 'On view', '6000 × 7500 px']) assert.ok(m.includes(s), `the inventory says: ${s}`);
  assert.ok(!m.includes('Otto') && !m.includes('Vanished Rooms') && !m.includes('Named Collector'), 'no other maker’s work, no place taken away, no holder’s name');
  assert.ok(/<td class="ppr-n">1<\/td>/.test(t), 'one piece held, as a count');
  assert.ok(/window\.print\(\)/.test(t) && /href="\/account\/table"/.test(t) && /lang="en"/.test(t), 'a Print press, a way back, a language');
  assert.ok(!NEVER.test(m), 'the inventory: none of the words: ' + (m.match(NEVER) || [''])[0]);
  t = await page('/account/table/inventory', otto.j); m = text(t);
  assert.ok(m.includes('Otto’s Secret Study') && !m.includes('Harbour') && !m.includes('rack 3'), 'the other maker reads only their own');
  t = await page('/account/table/inventory?q=harbour', pia.j); m = text(t);
  assert.ok(m.includes('Harbour, Morning') && !m.includes('Winter Field'), 'a word narrows it, asked of the database');
  // As a spreadsheet: the same page, with a formula made harmless.
  r = await go('/account/table/inventory.csv', {}, pia.j); const csv = await r.text();
  assert.ok(/text\/csv/.test(r.headers.get('content-type')) && /attachment; filename="ph-inventory\.csv"/.test(r.headers.get('content-disposition')), 'the CSV is a file to keep');
  assert.ok(csv.replace(/^﻿/, '').startsWith('accession,title,year,place,kind,medium,size,edition,signed,condition,where_it_is,at_watermark,pieces_held,shown,page\n') && csv.trim().split('\n').length === 5, 'a head and four works');
  assert.ok(csv.includes('"\'=Kept Aside"') && csv.includes('"Harbour, Morning"') && csv.includes('Studio, rack 3') && !csv.includes('Otto'), 'cells quoted; a title that begins with = cannot run as a formula');

  // 3. At scale: a page of 200 at a time, never the whole record; few questions whatever the size.
  const ins = db.prepare("INSERT INTO works (maker_id, slug, title, original_file, sha256, status, width, height, taken_at) VALUES (?,?,?,?,?,'held',4000,3000,'2019-01-01')");
  db.transaction(() => { for (let i = 0; i < 230; i++) ins.run(pia.id, `bulk-${i}`, `Bulk ${String(i).padStart(3, '0')}`, W(a).original_file, `f${i}`.padEnd(64, '0')); })();
  let asked = 0; const prep = db.prepare; db.prepare = function (s) { asked++; return prep.call(db, s); };
  t = await page('/account/table/inventory', pia.j); db.prepare = prep;
  assert.strictEqual((main(t).match(/<tr><td>/g) || []).length, 200, 'two hundred works a page');
  assert.ok(/200 of 234 works/.test(text(t)) && /rel="next">Older/.test(t) && /Your estate/.test(t), 'it says it is one page, with the way on and the whole catalogue named');
  assert.ok(asked <= 40, `the page asks few questions whatever the size of the record (${asked})`);
  const older = (t.match(/href="([^"]+)" rel="next"/) || [])[1].replace(/&amp;/g, '&');
  t = await page(older, pia.j); assert.ok(text(t).includes('Harbour, Morning') && /rel="prev">&larr; Newer/.test(t) && (main(t).match(/<tr><td>/g) || []).length === 34, 'the older page holds the rest');
  r = await go('/account/table/inventory.csv', {}, pia.j); assert.strictEqual((await r.text()).trim().split('\n').length, 201, 'the CSV is the same page of 200');

  // 4. A price list for a selection: the maker's own prices, a line to write another, nothing from the house.
  t = await page('/account/table/prices', pia.j); m = text(t);
  assert.ok(m.includes('Harbour, Morning') && m.includes('The Long Table') && !m.includes('Winter Field') && !m.includes('Bulk'), 'the picks, and only the picks');
  assert.ok(m.includes('16 × 24 in, edition of 12: $650') && m.includes('framed, $950'), 'the print price the maker set, as set');
  assert.deepStrictEqual([...new Set(m.match(/\$[\d,.]+/g))].sort(), ['$650', '$950'], 'no other figure is on the sheet: no sum, no suggestion');
  assert.strictEqual((main(t).match(/<input class="ppr-in"[^>]*>/g) || []).filter(i => !/value=/.test(i)).length, 2, 'a blank line a work, to write a price in; nothing filled in for the maker');
  assert.ok(!/<form[^>]*method="post"/i.test(t), 'what is written on the sheet is printed, not sent');
  assert.ok(!NEVER.test(m), 'the price list: none of the words: ' + (m.match(NEVER) || [''])[0]);
  // A hang as the selection: the maker's own works on that wall, in its order; another maker's work is not on her paper.
  t = await page(`/account/table/prices?from=hang:${hid}`, pia.j); m = text(t);
  assert.ok(m.indexOf('Winter Field') > 0 && m.indexOf('Winter Field') < m.indexOf('Harbour, Morning') && !m.includes('Otto') && !m.includes('The Long Table'), 'the hang, in its order, her own works only');
  // A private hang of hers is not a way for another maker to read anything.
  t = await page(`/account/table/prices?from=hang:${hid}`, otto.j); m = text(t);
  assert.ok(!m.includes('Harbour') && !m.includes('Winter Field'), 'her works are never on another maker’s paper');
  // (The test's makers are entered through the Studio's door, and the Studio may read any wall. A maker who is not the Studio:)
  const S = app.locals.papers.chosen({ query: { from: `hang:${hid}` }, cookies: {}, headers: {}, get: () => '' }, db.prepare('SELECT * FROM makers WHERE id=?').get(otto.id));
  assert.ok(S.label !== 'Rooms' && !S.hang && S.works.length === 0, 'a private wall of hers names nothing to another maker');
  // With nothing picked, the page says what to press.
  t = await page('/account/table/prices', otto.j); assert.ok(/No work is picked yet/.test(text(t)) && /name="from"/.test(t), 'no picks: told, with the next press');

  // 5. A consignment sheet: a form carrying what the maker states; not legal advice, said plainly; no term supplied.
  t = await page('/account/table/consignment', pia.j); m = text(t);
  assert.ok(/data-ppr-notice/.test(t) && /This is a form, not legal advice/.test(m) && /Watermark is not a party/.test(m) && /Have a lawyer read/.test(m), 'it says what it is');
  assert.ok(m.includes('Harbour, Morning') && m.includes('61 × 46 cm') && m.includes('unique') && m.includes('The Long Table'), 'the works, from the record');
  assert.ok(!/\d\s?%/.test(m) && !/\$\d/.test(m) && !/\b\d+ days\b/.test(m), 'no share, no price and no term is supplied by the house');
  const filled = (main(t).match(/<input class="ppr-in"[^>]*value="[^"]+"[^>]*>/g) || []); assert.ok(filled.length === 1 && /Pia Hart/.test(filled[0]), 'the one thing filled in is the maker’s own name');
  assert.ok(!/<form[^>]*method="post"/i.test(t), 'nothing is sent or kept');
  assert.ok(!NEVER.test(m), 'the consignment sheet: none of the words: ' + (m.match(NEVER) || [''])[0]);

  // 6. A checklist: the maker's selection; and the whole wall, for its curator alone.
  t = await page('/account/table/checklist', pia.j); m = text(t);
  assert.ok(m.includes('Harbour, Morning') && (main(t).match(/class="ppr-box"/g) || []).length === 4, 'two works, a box for hung and one for the label');
  t = await page(`/hang/${hid}/checklist`, pia.j); m = text(t);
  assert.ok(m.indexOf('Winter Field') < m.indexOf('Harbour, Morning') && m.includes('Otto’s Secret Study') && m.includes('Otto Rey') && /Rooms/.test(m), 'the wall in its order, every work on it with who made it');
  assert.ok(/href="\/hang\/\d+\/labels"/.test(t) && /href="\/hang\/rooms"/.test(t), 'beside the wall labels, with the way back to the wall');
  r = await go(`/hang/${hid}/checklist`, {}, {}); assert.strictEqual(r.status, 404, 'a stranger does not read a curator’s checklist'); // (a browser's navigation gets the house's own sign: src/breaks.js, test/breaks.js)
  r = await go(`/hang/${hid}/checklist`, {}, { wm_b: 'x' }); assert.strictEqual(r.status, 404, 'nor a made-up collector');
  // The wall labels that exist: linked, and offered without prices.
  t = await page(`/hang/${hid}/labels`, pia.j); assert.ok(/Wall labels/.test(t) && /\/checklist/.test(t) && /prices=0/.test(t) && /The wall/.test(t), 'the labels lead to the checklist, to a label without prices, and back');
  t = await page(`/hang/${hid}/labels?prices=0`, pia.j); assert.ok(/Winter Field/.test(t) && !/\$\d/.test(t.replace(/<style[\s\S]*?<\/style>/, '')) && !/Collect it on Watermark/.test(t), 'a label without prices');
  t = await page('/hang/rooms', pia.j); assert.ok(new RegExp(`href="/hang/${hid}/checklist"`).test(t) && new RegExp(`href="/hang/${hid}/labels"`).test(t), 'the hang’s own page leads its curator to both');
  t = await page('/hang/rooms', otto.j); assert.ok(!/\/checklist/.test(t), 'and no one else');

  // 7. The exhibition history: what the record holds, by year; a place taken away is not on it.
  t = await page('/account/table/exhibitions', pia.j); m = text(t);
  assert.ok(m.includes('Galerie Nord') && m.includes('New York, United States') && m.includes('on view now') && m.includes('Light and Water') && m.includes('lent to Museum of the Coast') && m.includes(String(year - 2)), 'the place stated and the loan that came home');
  assert.ok(!m.includes('Vanished Rooms') && m.indexOf('Galerie Nord') < m.indexOf('Light and Water'), 'the newest first; a place the maker took away is gone');
  assert.ok(/lists what is in the record and nothing else/.test(m) && !NEVER.test(m), 'it says it holds only the record');
  t = await page('/account/table/exhibitions', otto.j); assert.ok(/No place is stated on your works yet/.test(text(t)) && !text(t).includes('Galerie Nord'), 'another maker’s is their own');

  // 8. Reached from rooms that exist: the Library and Your estate. No room was added to a menu.
  t = await page('/account/table', pia.j); assert.ok(/href="\/account\/table\/inventory"[^>]*>Papers</.test(t), 'the Library leads to the papers');
  t = await page('/account/estate', pia.j); for (const p of PAPERS) assert.ok(t.includes(`href="${p}"`), `Your estate leads to ${p}`);
  const V = require('../src/views'); const rooms = JSON.stringify([V.ROOMS, V.DOORS]);
  assert.ok(!/table\/(inventory|prices|consignment|checklist|exhibitions)/.test(rooms), 'the papers are views of rooms that exist, on no menu');

  // 9. The certificate that exists (/c/:ref.pdf): it prints, says "the register", and carries the one statement of what
  // the holder holds (src/holds.js, #176) and no second wording of it.
  r = await go('/c/WM-2026-700001.pdf', {}, {}); const cert = Buffer.from(await r.arrayBuffer());
  assert.ok(r.status === 200 && cert.subarray(0, 5).toString() === '%PDF-', 'the certificate is a PDF');
  const pt = require('child_process').spawnSync('pdftotext', ['-layout', '-', '-'], { input: cert });
  if (pt.status === 0) {
    const ct = pt.stdout.toString().replace(/\s+/g, ' '); if (process.env.PAPERS_SHOW) console.log(ct);
    assert.ok(/WM-2026-700001/.test(ct) && /The Long Table/.test(ct) && /Pia Hart/.test(ct) && !/ledger|blockchain|\btoken/i.test(ct), 'the work, the maker, and none of the words');
    assert.strictEqual((pt.stdout.toString().match(/\f/g) || []).length, 1, 'on one page');
    let H = null; try { H = require('../src/holds'); } catch (e) { H = null; }
    if (H) {
      const lic = db.prepare("SELECT * FROM licenses WHERE ref='WM-2026-700001'").get(), u = db.prepare('SELECT * FROM uses WHERE id=?').get(social);
      const want = H.statement(H.ofLicense(lic, u, W(b), 'Pia Hart')).text.replace(/\s+/g, ' ');
      const sq = x => x.replace(/\s+/g, '');
      assert.ok(/WHATYOUHOLD/.test(sq(ct)) && sq(ct).includes(sq(want)), 'the certificate says what the holder holds, in the house’s one statement');
      assert.ok(H.termsOf(u, H.ofLicense(lic, u, W(b), 'Pia Hart').t).transferable ? !/non-transferable/.test(ct) : /non-transferable/.test(ct), '“non-transferable” only where the stored terms say so');
      console.log('ok: the certificate carries the statement of what the holder holds');
    } else console.log('note: src/holds.js (#176, PR #180) is not in this tree: the certificate prints without the statement until it is');
  } else console.log('note: pdftotext is not on this machine: the certificate’s words were not read');

  // 10. Printed, in a browser: each paper as a person prints it.
  if (process.env.PAPERS_PRINT === '1') {
    const { chromium } = require('playwright');
    const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}).catch(() => chromium.launch({ channel: 'chrome' }));
    const out = process.env.PAPERS_OUT || null; if (out) fs.mkdirSync(out, { recursive: true });
    for (const [vw, vh] of [[1280, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
      await ctx.addCookies(Object.entries(pia.j).filter(([, v]) => v).map(([name, value]) => ({ name, value, url: base })));
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('response', rs => { if (rs.status() >= 400) errs.push(`${rs.status()} ${rs.url().replace(base, '')}`); });
      for (const p of [...PAPERS, `/account/table/prices?from=hang:${hid}`, `/hang/${hid}/checklist`, `/hang/${hid}/labels`, `/hang/${hid}/labels?prices=0`]) {
        const resp = await pg.goto(base + p, { waitUntil: 'load' }); assert.strictEqual(resp.status(), 200, `${p} opens`);
        const name = p.replace(/^\/(account\/table\/|hang\/\d+\/)/, '').replace(/[^a-z0-9]+/gi, '-');
        // On the screen: nothing wider than the page (a table scrolls inside its own box); the Print press is there.
        const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (!/labels/.test(p)) assert.ok(wide <= 1, `${p} at ${vw}: the page does not scroll sideways (${wide})`);
        if (!/labels/.test(p)) { const btn = await pg.locator('.ppr-bar button').boundingBox(); assert.ok(btn && btn.height >= 44, `${p} at ${vw}: a Print press a thumb can reach`); }
        // What a person writes on a sheet is printed with it.
        const write = pg.locator('main input.ppr-in'); const typed = (await write.count()) ? 'Typed by Pia, 1,200' : null;
        if (typed) await write.last().fill(typed);
        await pg.emulateMedia({ media: 'print' });
        if (!/labels/.test(p)) {
          for (const sel of ['.ppr-bar', '.ppr-pick']) if (await pg.locator(sel).count()) assert.strictEqual(await pg.locator(sel).first().boundingBox(), null, `${p}: ${sel} is not printed`);
          assert.ok(await pg.locator('main h1').first().boundingBox(), `${p}: the paper’s head is printed`);
          const ink = await pg.evaluate(() => { const b = getComputedStyle(document.body); return [b.backgroundColor, b.color]; }); assert.deepStrictEqual(ink, ['rgb(255, 255, 255)', 'rgb(11, 10, 9)'], `${p}: black on white`);
          if (typed) assert.ok(await write.last().boundingBox() && (await write.last().inputValue()) === typed, `${p}: what was written is on the printed sheet`);
          const pics = await pg.evaluate(() => [...document.querySelectorAll('main img')].map(i => i.complete && i.naturalWidth > 0)); assert.ok(pics.every(Boolean), `${p}: every picture on the sheet is there to print (${pics.filter(x => !x).length} missing of ${pics.length})`);
        } else assert.strictEqual(await pg.locator('.top').boundingBox(), null, `${p}: the bar is not printed`);
        if (vw === 1280) { const pdf = await pg.pdf({ format: 'Letter', printBackground: false }); assert.ok(pdf.length > 1500 && pdf.subarray(0, 5).toString() === '%PDF-', `${p}: prints to a PDF`); if (out) fs.writeFileSync(path.join(out, `${name}.pdf`), pdf); }
        await pg.emulateMedia({ media: 'screen' });
      }
      // The certificate's own page, as it prints (looked at, not judged: its print style is the house's, not this job's).
      if (vw === 1280 && out) { await pg.goto(base + '/c/WM-2026-700001', { waitUntil: 'load' }); await pg.emulateMedia({ media: 'print' }); fs.writeFileSync(path.join(out, 'certificate-page.pdf'), await pg.pdf({ format: 'Letter' })); await pg.emulateMedia({ media: 'screen' }); }
      assert.deepStrictEqual(errs, [], 'no error on any paper: ' + errs.join(' | '));
      await ctx.close();
    }
    await browser.close();
    console.log('ok: each paper prints in a browser (desk and phone widths): the bar is not printed, what was written is, every picture is there');
  } else console.log('note: the print walk needs a browser (PAPERS_PRINT=1; CI runs it in the a11y job)');

  srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  console.log('ok: a maker’s working papers come out of the record: inventory, price list, consignment sheet, checklist, labels, exhibition history');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
