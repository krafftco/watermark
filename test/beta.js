// The beta and the test house: feedback lands and is read in the Studio; the launch switch takes the beta word
// down; the test house refuses live keys, mails only its testers and is never indexed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const mail = require('../src/mail');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-beta-'));
  const app = createApp({ dataDir, adminPassword: 'pw', secret: 's', stripeKey: '', base: 'http://localhost', noTimers: true });
  const srv = app.listen(0); const port = srv.address().port, B = `http://localhost:${port}`;
  const form = o => new URLSearchParams(o).toString(), H = { 'content-type': 'application/x-www-form-urlencoded' };
  let r = await fetch(B + '/collection'); let t = await r.text();
  assert.ok(t.includes('class="beta"') && t.includes('/feedback?from='), 'beta by the wordmark and in the footer');
  r = await fetch(B + '/feedback', { method: 'POST', headers: H, body: form({ kind: 'broke', body: 'The basket emptied itself.', from: '/basket', email: 'tester@example.com' }), redirect: 'manual' });
  assert.ok(/sent=1/.test(r.headers.get('location')), 'feedback taken');
  r = await fetch(B + '/feedback', { method: 'POST', headers: H, body: form({ body: 'spam', website: 'x' }), redirect: 'manual' });
  assert.strictEqual(app.locals.beta.open(), 1, 'the hidden field keeps robots out');
  r = await fetch(B + '/studio/login', { method: 'POST', headers: H, body: form({ password: 'pw' }), redirect: 'manual' });
  const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ');
  r = await fetch(B + '/studio/feedback', { headers: { cookie: ck } }); t = await r.text();
  assert.ok(t.includes('The basket emptied itself.') && t.includes('/basket'), 'read in the Studio');
  r = await fetch(B + '/studio/launch', { headers: { cookie: ck } }); t = await r.text();
  assert.ok(t.includes('Before the announcement') && t.includes('In beta.'), 'the launch list');
  await fetch(B + '/studio/launch/state', { method: 'POST', headers: { ...H, cookie: ck }, body: form({ launched: '1' }), redirect: 'manual' });
  r = await fetch(B + '/collection'); t = await r.text();
  assert.ok(!t.includes('class="beta"') && !t.includes('foot-beta'), 'launched: the beta word is down');
  await fetch(B + '/studio/launch/state', { method: 'POST', headers: { ...H, cookie: ck }, body: form({ launched: '0' }), redirect: 'manual' });
  srv.close();

  // The test house.
  process.env.STAGING = '1';
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-stg-'));
  const app2 = createApp({ dataDir: d2, adminPassword: 'pw', secret: 's', stripeKey: 'sk_live_refused', base: 'http://localhost', noTimers: true });
  const s2 = app2.listen(0); const B2 = `http://localhost:${s2.address().port}`;
  r = await fetch(B2 + '/robots.txt'); assert.ok(/Disallow: \/\n/.test(await r.text()), 'never indexed');
  r = await fetch(B2 + '/collection'); t = await r.text(); assert.ok(t.includes('The test house.') && t.includes('noindex'), 'the band, and noindex');
  r = await fetch(B2 + '/healthz'); assert.strictEqual((await r.json()).stripe, false, 'a live key is refused');
  const saved = process.env.RESEND_API_KEY, savedF = global.fetch; process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_ALLOW = 'will@krafftco.com, @tester.org';
  const sent = []; global.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; };
  await mail.send({ to: 'stranger@example.com', subject: 'x', text: 'y' });
  await mail.send({ to: 'a@tester.org', subject: 'Collected', text: 'y' });
  global.fetch = savedF; if (saved === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved; delete process.env.STAGING; delete process.env.MAIL_ALLOW;
  assert.strictEqual(sent.length, 1, 'only testers are mailed'); assert.ok(sent[0].subject.startsWith('[Test house]'), 'and the subject says so');
  s2.close();
  console.log('ok: the beta and the test house');
})().catch(e => { console.error(e); process.exit(1); });
