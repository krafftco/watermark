// Which browser engine a walk drives (#55). WM_ENGINE=chromium (the default) or webkit: an iPad and an iPhone run
// Safari's engine whatever the browser's name, and only GitHub's runners can download Playwright's WebKit.
//   - chromium: each walk keeps its own way of finding Chrome (unchanged).
//   - webkit: Playwright's WebKit with Apple device profiles. Not installed here: one line, and exit 0 on a machine
//     (nothing is proved, and it says so); exit 1 in CI, where the job installed it and its absence is a fault.
const fs = require('fs');
const pw = require('playwright');

const name = (process.env.WM_ENGINE || 'chromium').toLowerCase();
if (!['chromium', 'webkit'].includes(name)) { console.error(`WM_ENGINE=${name}: chromium or webkit`); process.exit(2); }
const webkit = name === 'webkit';

// Call first, before a test house is built: a missing WebKit is said at once.
function guard(walk) {
  if (!webkit) return;
  let exe = ''; try { exe = pw.webkit.executablePath(); } catch (e) { /* */ }
  if (exe && fs.existsSync(exe)) return;
  if (process.env.CI) {
    console.log(`::error title=${walk} webkit::WebKit is not installed (looked for ${exe || 'nothing'}); the job installs it with npx playwright install --with-deps webkit`);
    process.exit(1);
  }
  console.log(`${walk}: WebKit is not installed on this machine; the WebKit pass is skipped here and runs in CI (reach-webkit).`);
  process.exit(0);
}

const launch = () => pw.webkit.launch();

module.exports = { name, webkit, guard, launch, devices: pw.devices };
