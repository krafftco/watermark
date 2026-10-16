// Prints a new VAULT_KEY. Run once, store it in two safe places, and put it in the host's settings.
// Never change it on a vault that already holds files.
console.log(require('crypto').randomBytes(32).toString('base64'));
