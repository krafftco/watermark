const { createApp } = require('./src/app');
const port = process.env.PORT || 3000;
// The house does not fall for one bad promise (27 Oct: a crash loop empties every queue and shows the cold page): a
// rejection nobody caught is logged with its stack and the house goes on serving; a thrown exception outside any
// request is logged the same way, and only a second one inside a minute ends the process (something is truly broken,
// and Render brings it back). Both are counted on /healthz (full) as `faults`.
const faults = { rejections: 0, exceptions: 0, last: null };
process.on('unhandledRejection', (e) => { faults.rejections++; faults.last = { at: new Date().toISOString(), kind: 'rejection', message: String(e && e.message || e), stack: e && e.stack }; console.error('[house] unhandled rejection:', e && e.stack || e); });
let lastException = 0;
process.on('uncaughtException', (e) => { faults.exceptions++; faults.last = { at: new Date().toISOString(), kind: 'exception', message: String(e && e.message || e), stack: e && e.stack }; console.error('[house] uncaught exception:', e && e.stack || e); const now = Date.now(); if (now - lastException < 60000) { console.error('[house] a second exception inside a minute: leaving it to the host'); process.exit(1); } lastException = now; });
process.faults = faults;
const app = createApp();
// Prove the vault key is right before serving or writing anything.
app.locals.store.checkKey()
  .then(state => {
    console.log(`Vault: ${app.locals.store.kind}, ${state === 'off' ? 'provider encryption only (set VAULT_KEY to seal with Watermark\'s own key)' : 'sealed with Watermark\'s own key'}`);
    const server = app.listen(port, () => console.log(`Watermark listening on ${port}`));
    // Idle connections outlive the proxies in front (5 Nov: a 502 from the edge in 150 ms, one request in thirty-five,
    // the house up and well): Node closes an idle keep-alive connection after five seconds by default, and the proxy
    // in front may reuse it at that moment and get a reset. The house now holds idle connections longer than any proxy
    // in front of it, so the proxy always closes first.
    server.keepAliveTimeout = Number(process.env.KEEPALIVE_MS || 65000);
    server.headersTimeout = server.keepAliveTimeout + 1000;
    // The watchdog (9 Nov): a website that stops answering restarts itself instead of waiting for a person.
    try { require('./src/watchdog').start({ port, governor: app.locals.governor, role: require('./src/role') }); } catch (e) { console.error('[watchdog]', e.message); }
  })
  .catch(e => { console.error(e.message); process.exit(1); });

// The loop's holds, said (9 Nov, 11:35 pm: the website stopped answering for some thirty seconds, Render took it out of
// rotation and visitors saw 502 for four minutes; nothing in the log said what it had been doing). Every process that
// answers visitors now says when the event loop was held longer than LOOP_LAG ms (1500; the scale test asks for 300),
// with the request that was running and the last few before it. LOOP_LAG=0 turns it off.
{ const role = require('./src/role'); const over = process.env.LOOP_LAG === undefined ? (role.web && process.env.NODE_ENV !== 'test' ? 1500 : 0) : Number(process.env.LOOP_LAG);
  if (over > 0) { let last = Date.now(); setInterval(() => { const now = Date.now(), d = now - last - 100; last = now; if (d > over) { const r = global.__wmLast || []; console.log('[lag]', d, 'ms; running or just run:', r.slice(-4).join(' | ') || 'no request (a timer)'); } }, 100).unref(); } }
