const { createApp } = require('./src/app');
const port = process.env.PORT || 3000;
const app = createApp();
// Prove the vault key is right before serving or writing anything.
app.locals.store.checkKey()
  .then(state => {
    console.log(`Vault: ${app.locals.store.kind}, ${state === 'off' ? 'provider encryption only (set VAULT_KEY to seal with Watermark\'s own key)' : 'sealed with Watermark\'s own key'}`);
    app.listen(port, () => console.log(`Watermark listening on ${port}`));
  })
  .catch(e => { console.error(e.message); process.exit(1); });
