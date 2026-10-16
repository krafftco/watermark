// Seed the vault with photographs already published in Krafft Studios.
// Usage: node scripts/seed.js <folder-with-originals>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createApp } = require('../src/app');

const SEED = [
  ['JOE_PARIS-037.jpg', 'The Louvre', 'Paris, France', null, 'https://studios.krafftco.com/paris/'],
  ['JOE_PARIS-159.jpg', 'The Seine', 'Paris, France', null, 'https://studios.krafftco.com/paris/'],
  ['JOE_COMO-13.jpg', 'Cypresses', 'Lake Como, Italy', null, 'https://studios.krafftco.com/lake-como/'],
  ['JOE_COMO-38.jpg', 'The harbor at dusk', 'Lake Como, Italy', null, 'https://studios.krafftco.com/lake-como/'],
  ['JOE_FLORENCE-002.jpg', 'Toward the Duomo', 'Florence, Italy', null, 'https://studios.krafftco.com/florence/'],
  ['JOE_FLORENCE-016.jpg', 'The Lamb', 'Florence, Italy', 'Stained glass.', 'https://studios.krafftco.com/florence/'],
  ['JOE_FLORENCE-021.jpg', 'The dome, from below', 'Florence, Italy', 'Looking up into the cathedral dome.', 'https://studios.krafftco.com/florence/'],
  ['JOE_FLORENCE-097.jpg', 'The Uffizi', 'Florence, Italy', null, 'https://studios.krafftco.com/florence/'],
  ['JOE_FLORENCE-172.jpg', 'David, in the piazza', 'Florence, Italy', null, 'https://studios.krafftco.com/florence/'],
  ['JOE_FLORENCE-207.jpg', 'Sunset over the Arno', 'Florence, Italy', 'The whole city from the hill.', 'https://studios.krafftco.com/florence/'],
];

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node scripts/seed.js <folder>'); process.exit(1); }
  const files = {};
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files[f] = p; } })(dir);
  const app = createApp();
  const { registerWork } = app.locals;
  for (const [file, title, place, caption, source_url] of SEED) {
    if (!files[file]) { console.log('missing', file); continue; }
    const tmp = path.join(os.tmpdir(), `wm-${Date.now()}-${file}`);
    fs.copyFileSync(files[file], tmp);
    try { const w = await registerWork({ file: tmp, originalName: file, title, place, caption, source_url }); console.log('held', w.slug, w.camera || ''); }
    catch (e) { console.log('skip', file, e.message); }
  }
})();
