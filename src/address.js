// The house's address, in one place (#215; Will, 23 Nov 2026: the house stands at its own address). Every page, letter,
// paper, feed and file that names "this house" reads it here; nothing else in the code spells a host.
//   BASE_URL     where the house stands (scheme and host, no path). Unset, it is where the house first stood.
//   OLD_HOSTS    hosts the house has left, comma-separated. Unset, it is where the house first stood. A GET or HEAD
//                arriving on one is sent on, permanently, to the same path and query at BASE_URL (app.js). The host the
//                house stands on is never an old host, so with neither set nothing is redirected.
//   LIVE_URL     on the test house only: where the live house stands. Unset, where the house first stood.
//   HOUSE_EMAIL  the house's letterbox. It does NOT follow BASE_URL: mail to a domain with no mailbox is lost, so the
//                letterbox moves only when Will has moved the mail (docs/OPERATIONS.md, "Moving the house's address").
// The namespaces below are names, not addresses: they are written inside files and credentials already issued, and a
// reader matches them letter for letter. They never change, wherever the house stands.
const FIRST = 'watermark.krafftco.com';
const base = () => String(process.env.BASE_URL || `https://${FIRST}`).replace(/\/+$/, '');
const hostOf = b => { try { return new URL(b).host.toLowerCase(); } catch (e) { return ''; } };
const host = () => hostOf(base()) || FIRST;
const email = () => process.env.HOUSE_EMAIL || `house@${FIRST}`;
const sender = () => `Watermark <house@${FIRST}>`; // the verified sending domain: mail.js falls back to it when MAIL_FROM is refused
// The hosts the house has left, for a house standing at `at` (a base URL; the setting when not given).
const oldHosts = (at, list) => {
  const here = hostOf(at || base());
  return String(list != null ? list : process.env.OLD_HOSTS != null ? process.env.OLD_HOSTS : FIRST).split(',').map(h => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(h => h && h !== here);
};
// The hosts the house's identity has stood on and left (#220): the old hosts, and where the house first stood whatever
// OLD_HOSTS says (`none` stops the redirect, not the identity: a credential issued there names that host for good).
const leftHosts = (at, list) => { const here = hostOf(at || base()); return [...new Set([...oldHosts(at, list), FIRST])].filter(h => h !== here && h.includes('.')); }; // a host has a dot: "none" is not one
// The live house, as the test house names it on its banner (the test house's own BASE_URL is its own address).
const live = () => String(process.env.LIVE_URL || `https://${FIRST}`).replace(/\/+$/, '');
const NS = { xmp: `https://${FIRST}/ns/1.0/`, vc: `https://${FIRST}/ns#` };
module.exports = { base, host, hostOf, email, sender, oldHosts, leftHosts, live, NS };
