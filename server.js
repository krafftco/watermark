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
    app.listen(port, () => console.log(`Watermark listening on ${port}`));
  })
  .catch(e => { console.error(e.message); process.exit(1); });
