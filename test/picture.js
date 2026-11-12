// Never a broken picture (9 Nov): a page that cannot load a picture tells the house; a missing copy takes the work off
// the open walls and is made again; repeated reports with the copy in place send it to the restoration room.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-picture-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'picture', noTimers: true, vaultNow: true });
  const { db } = app.locals; const P = app.locals.pictures; const images = require('../src/images'); const cache = path.join(dir, 'cache');
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const f = path.join(dir, 'in.jpg'); fs.copyFileSync(path.join(__dirname, 'fixture.jpg'), f);
  const w = await app.locals.registerWork({ file: f, title: 'The Chandelier', place: 'Paris', originalName: 'in.jpg' });
  db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug);
  await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug));
  assert.ok(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'copies made');
  // The copy is there: the visitor's connection; the third report inside the hour asks for a check.
  assert.equal(await P.failed(w.slug, 'screen'), 'sound'); assert.equal(await P.failed(w.slug, 'screen'), 'sound'); assert.equal(await P.failed(w.slug, 'screen'), 'check');
  assert.equal(await P.checks(), 1, 'the worker checks it'); assert.equal(db.prepare('SELECT state FROM picture_reports WHERE slug=?').get(w.slug).state, 'checked');
  assert.ok(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'a sound work stays on the walls');
  // The copy is gone: off the open walls, a ticket, and made again.
  for (const fm of ['jpg', 'webp']) { try { fs.unlinkSync(images.fileOf(cache, w.slug, 'screen', fm)); } catch (e) { /* */ } }
  const r = await fetch(`${base}/api/picture/failed?s=${w.slug}&z=screen`, { method: 'POST', headers: { origin: 'http://localhost' } }); assert.equal(r.status, 204);
  for (let i = 0; i < 40 && db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at; i++) await new Promise(x => setTimeout(x, 50));
  assert.equal(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, null, 'off the open walls until remade');
  assert.ok(db.prepare('SELECT 1 FROM render_asks WHERE slug=?').get(w.slug), 'a ticket for the scribes');
  assert.equal(db.prepare('SELECT state FROM picture_reports WHERE slug=?').get(w.slug).state, 'remaking');
  await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug));
  assert.ok(fs.existsSync(images.fileOf(cache, w.slug, 'screen', 'jpg')) && db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'made again, back on the walls');
  // A work not on view, or unknown, is nothing to report.
  assert.equal(await P.failed('no-such-work', 'screen'), 'not on view');
  // The page keeps a failed picture unseen, tries again, and tells the house.
  const html = await (await fetch(`${base}/about`)).text(); assert.ok(html.includes('/api/picture/failed') && html.includes('wm-ld'), 'the head script');
  // The placeholder is never final (issue #9): the page tells it by its size (24 × 16), keeps it unseen, asks again, and shows the real copy once made.
  const sharp = require('sharp');
  const f2 = path.join(dir, 'in2.jpg'); fs.writeFileSync(f2, await sharp(path.join(__dirname, 'fixture.jpg')).flop().modulate({ brightness: 0.6 }).jpeg().toBuffer()); // another picture
  const u = await app.locals.registerWork({ file: f2, title: 'The Unmade', place: 'Paris', originalName: 'in2.jpg' });
  db.prepare("UPDATE works SET status='held' WHERE slug=?").run(u.slug);
  process.env.NO_MASTER_ON_WEB = '1'; // the website of a split house: nothing made yet is the wall's dark
  let pr = await fetch(`${base}/img/${u.slug}/screen?f=jpg`); assert.equal(pr.headers.get('x-making'), '1', 'the placeholder');
  let md = await sharp(Buffer.from(await pr.arrayBuffer())).metadata(); assert.ok(md.width === 24 && md.height === 16, 'the placeholder is 24 × 16: the signal');
  pr = await fetch(`${base}/img/${w.slug}/thumb?f=jpg`); assert.ok(!pr.headers.get('x-making'));
  md = await sharp(Buffer.from(await pr.arrayBuffer())).metadata(); assert.ok(!(md.width === 24 && md.height === 16) && md.width > 100, 'a real copy is never taken for it');
  const page = await (await fetch(`${base}/about`)).text();
  for (const m of page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { if (!/application\/(ld\+)?json|speculationrules/.test(m[0].slice(0, 80))) new Function(m[1]); } // every inline script compiles
  let pw = null; try { pw = require('playwright'); } catch (e) { /* not on CI */ }
  let browser = null; if (pw) { try { browser = await pw.chromium.launch(); } catch (e) { browser = null; } }
  if (!browser) console.log('picture: the page walk skipped (no Playwright here)');
  else {
    const pg = await (await browser.newContext({ serviceWorkers: 'block' })).newPage(); let asked = 0; const seen = []; // sw.js's own fetches pass page.route by; sw.js is checked by its words below
    await pg.route(`${base}/t-page`, r => r.fulfill({ contentType: 'text/html', body: page.replace(/<body([^>]*)>/, `<body$1><img id="tp" src="/img/${u.slug}/screen?f=jpg" alt="">`) }));
    await pg.route(new RegExp(`/img/${u.slug}/screen`), async r => { asked++; seen.push(r.request().url()); if (asked === 3) await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE slug=?').get(u.slug)); r.continue(); });
    await pg.goto(`${base}/t-page`);
    await pg.waitForFunction(() => { const i = document.getElementById('tp'); return i && i.naturalWidth > 24; }, null, { timeout: 30000 });
    const st = await pg.evaluate(() => { const i = document.getElementById('tp'); return { ld: i.classList.contains('ld'), w: i.naturalWidth, mk: i.dataset.mk, op: getComputedStyle(i).opacity }; });
    assert.equal(asked, 3, 'asked twice more, then shown: ' + seen.join(' '));
    assert.ok(st.ld && st.w > 100 && st.mk === '2', 'the real picture, final: ' + JSON.stringify(st));
    assert.ok(/_m=2$/.test(seen[2]) && !/_m=/.test(seen[0]), 'each ask a fresh address: ' + seen.join(' '));
    await browser.close(); console.log('picture: the placeholder is asked again, and the real one shown');
  }
  assert.ok(/!res\.headers\.get\('x-making'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8')), 'sw.js never keeps the placeholder');
  delete process.env.NO_MASTER_ON_WEB;
  srv.close(); console.log('picture: never a broken one'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
