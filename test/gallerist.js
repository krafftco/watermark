// Your gallerist (4 Nov): notes in plain words on what stands between a work and the people who want it.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gst-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'gst', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await form('/studio/login', { password: 'pw' }); await form('/studio/accounts', { name: 'Ada Lindqvist', invite: '0' });
  const m = db.prepare("SELECT * FROM makers WHERE name='Ada Lindqvist'").get();
  const mkw = async (title, px) => { const f = path.join(dir, title + '.jpg'); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(px).modulate({ hue: title.length * 23 }).jpeg().toBuffer()); return app.locals.registerWork({ file: f, title, makerId: m.id, originalName: title + '.jpg' }); };
  const kept = await mkw('Harbour At Dusk', 1200), small = await mkw('The Staircase', 1200), quiet = await mkw('A Gate', 1200);
  db.prepare("UPDATE works SET status='hidden', keep_back=0 WHERE slug=?").run(kept.slug);
  db.prepare("UPDATE works SET status='held' WHERE slug IN (?, ?)").run(small.slug, quiet.slug);
  const stand = (w, n, s) => { for (let i = 0; i < n; i++) db.prepare("INSERT INTO stood (work_id, viewer, seconds, visits) VALUES (?, ?, ?, ?)").run(w.id, `v${w.id}-${i}`, s, i === 0 ? 2 : 1); };
  stand(kept, 5, 90); stand(small, 4, 70); stand(quiet, 1, 5);
  await go(`/account?maker=${m.handle}`);
  const gr = await go('/account/gallerist'); let t = await gr.text(); if (process.env.DBG) console.log('STATUS', gr.status, gr.headers.get('location'), (t.match(/<article[\s\S]{0,500}/) || [t.slice(0, 300)])[0]); if (process.env.DBG) console.log(t.replace(/<script[\s\S]*?<\/script>/g,'').slice(t.indexOf('gst'), t.indexOf('gst') + 3000));
  assert.ok(t.includes('kept <b>Harbour at Dusk</b> to yourself') && t.includes('5 people found it anyway'), 'the kept-back work that holds people');
  assert.ok(t.includes('<b>The Staircase</b> could hang above a sofa') && t.includes('Send the full file'), 'the file too small to print');
  assert.ok(!t.includes('A Gate'), 'one person is not enough to speak');
  assert.ok(!/Cole|v\d+-\d/.test(t), 'nobody named');
  // Show it, by the maker's word
  const r = await form('/account/works/batch', { do: 'publish', attest: '1', slugs: kept.slug, json: '1' }); assert.ok((await r.json()).ok !== false);
  assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(kept.slug).status, 'held', 'shown');
  const f = app.locals.gallerist.first(m); assert.ok(f && f.text && !/<|&amp;/.test(f.text), 'the first note in plain words: ' + JSON.stringify(f));
  const L = require('../src/mail-letters').friday({ ...app.locals.payouts.letterFor(m) });
  assert.ok(L.html.includes('From your gallerist') && L.text.includes('From your gallerist'), 'the Friday letter carries it');
  srv.close(); console.log('gallerist: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
