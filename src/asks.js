// What each source asks of a machine (#170, docs/SOURCES.md; read from their own pages on 20 Nov 2026). Every request the
// house makes to a museum's, a library's or an index's server goes through `wrap`, so the asks are kept in one place:
//   The Library of Congress: "no more than 10 requests per minute to our applications" (loc.gov/legal): one request to any
//     loc.gov host every LOC_GAP_MS (6 s), across every job in this process.
//   The Art Institute of Chicago: "Consider adding a AIC-User-Agent header with the name of your project and a contact
//     email" (api.artic.edu/docs): sent on every request to artic.edu (the API and the IIIF server), the contact read from
//     HOUSE_EMAIL. The image size taken is not changed here (a question for the museum, docs/SOURCES.md).
//   Project Gutenberg: "The Project Gutenberg website is intended for human users only" (gutenberg.org/policy/robot_access);
//     Gutendex: "You should run your own server, but you can test queries at gutendex.com". Every request to gutenberg.org
//     or gutendex.com is paused until Will chooses their harvest endpoint, a mirror or our own Gutendex. The harvest
//     endpoint (/robot/harvest), the way they offer, is not paused. Books already in the house stay as they are.
const LOC_GAP_MS = 6000;
const PAUSED_LINE = 'Bringing in from Project Gutenberg is paused while the house moves to the way they ask to be read.'; // a draft for Will
const hostOf = u => { try { return new URL(String(u && u.url ? u.url : u)).hostname.toLowerCase(); } catch (e) { return ''; } };
const pathOf = u => { try { return new URL(String(u && u.url ? u.url : u)).pathname; } catch (e) { return ''; } };
const isLoc = h => /(^|\.)loc\.gov$/.test(h);
const isAic = h => /(^|\.)artic\.edu$/.test(h);
const isGutenberg = (h, p) => (/(^|\.)gutenberg\.org$/.test(h) && !/^\/robot\/harvest/.test(p || '')) || /(^|\.)gutendex\.com$/.test(h);
// GUTENBERG_OPEN=1 (Will's switch, in the host's settings, once he has chosen a way they offer) lifts the pause.
const open = () => process.env.GUTENBERG_OPEN === '1';
const paused = u => !open() && isGutenberg(hostOf(u), pathOf(u));
const aicAgent = () => `Watermark (${require('./address').base()}${process.env.HOUSE_EMAIL ? `; ${process.env.HOUSE_EMAIL}` : ''})`;
let locNext = 0; // when the next loc.gov request may leave, for the whole process
const log = []; // the last waits, for the tests and /healthz-minded readers
function pausedError() { const e = new Error(PAUSED_LINE); e.paused = true; e.code = 'SOURCE_PAUSED'; return e; }
// fetchFn: the fetch to call. noTimers: tests (no sleeping; the wait is still counted). sleep, now: for a test's clock.
function wrap(fetchFn, { noTimers = false, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  return async function askedFetch(u, o) {
    const h = hostOf(u);
    if (paused(u)) throw pausedError();
    let opts = o;
    if (isAic(h)) opts = { ...(o || {}), headers: { ...((o && o.headers) || {}), 'AIC-User-Agent': aicAgent() } };
    if (isLoc(h)) { const t = now(); const wait = Math.max(0, locNext - t); locNext = Math.max(t, locNext) + LOC_GAP_MS; log.push({ host: h, wait }); if (log.length > 50) log.shift(); if (wait && !(typeof noTimers === 'function' ? noTimers() : noTimers)) await sleep(wait); }
    return (fetchFn || fetch)(u, opts);
  };
}
const reset = () => { locNext = 0; log.length = 0; };
module.exports = { wrap, paused, PAUSED_LINE, LOC_GAP_MS, aicAgent, log, reset, isGutenberg: u => paused(u) };
