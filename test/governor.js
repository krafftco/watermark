// The governor counts people, not the house (#196; 22 Nov: the worker's log said "40 visitors in ten seconds" every
// minute, and every copy ask waited the full minute). The 40 were the worker's own prepared round (prepared.js asks its
// own house for up to PREPARED_PER_ROUND (40) stranger pages every PREPARED_ROUND_MS (10 s), signed `x-wm-prepare`).
// Each role is a fresh process (the role is read once at require). The worker, a scribe and a one-process house do not
// count the house's own requests; the website (ROLE=web) counts exactly as before; a person counts everywhere.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const src = p => JSON.stringify(path.join(__dirname, '..', 'src', p));
const probe = `
  const fs = require('fs'), os = require('os'), path = require('path');
  const { createApp } = require(${src('app')}); const ROLE = require(${src('role')});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-governor-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'governor', noTimers: true, vaultNow: true, prepared: true });
  const G = app.locals.governor, P = app.locals.prepared;
  (async () => {
    let made = 0; for (let i = 0; i < 2; i++) { const r = await P.round({ all: true }); made += r.made; } // the house asking itself, twice over
    const a = G.state();
    const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
    for (let i = 0; i < 3; i++) await (await fetch(base + '/about')).text(); // a person
    // A stranger who copies the header with a wrong key is a person.
    await (await fetch(base + '/about', { headers: { 'x-wm-prepare': 'x'.repeat(48) } })).text();
    const b = G.state(); srv.close(); fs.rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify({ role: ROLE.role, made, own: a.own10s, before: a.visitors10s, busyBefore: a.busy, after: b.visitors10s }));
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
`;
const run = role => { const out = execFileSync(process.execPath, ['-e', probe], { cwd: path.join(__dirname, '..'), env: { ...process.env, ROLE: role, NODE_ENV: 'test' }, encoding: 'utf8', maxBuffer: 64 << 20 }); return JSON.parse(out.trim().split('\n').pop()); };

for (const role of ['worker', 'all', 'scribe']) {
  const r = run(role);
  assert.ok(r.made >= 10, `${role}: the round made its copies by asking the house: ${JSON.stringify(r)}`);
  assert.deepStrictEqual([r.own, r.before, r.busyBefore, r.after], [r.made, 0, false, 4], `${role}: the house's own requests are not visitors; people are: ${JSON.stringify(r)}`);
  console.log(`governor: ${role}: ${r.made} of the house's own requests, 0 visitors; then 4 people counted`);
}
const web = run('web');
assert.ok(web.made >= 10, JSON.stringify(web));
assert.deepStrictEqual([web.own, web.before, web.busyBefore, web.after], [0, web.made, true, web.made + 4], `web: counts as before (every non-static request): ${JSON.stringify(web)}`);
console.log(`governor: web: ${web.made} requests counted as before (busy), then 4 more`);
console.log('governor: holds');
