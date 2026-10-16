// Studios → Watermark sync: places go up publicly in rooms, people-led stories are held privately,
// the original upload (_o) is preferred, and a second run adds nothing.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { photosIn } = require('../src/studios-sync');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sync-'));
  const jpg = seed => sharp({ create: { width: 64 + seed, height: 48, channels: 3, background: { r: seed * 20, g: 90, b: 140 } } }).jpeg().toBuffer();
  const imgs = { 'flo-1_o.jpg': await jpg(1), 'flo-2.jpg': await jpg(2), 'people-1_o.jpg': await jpg(3) };
  const G = 'https://studios.test/content/images/2026/10/';
  const posts = [
    { slug: 'florence', title: 'Florence', url: 'https://studios.test/florence/', tags: [{ slug: 'travel', name: 'Travel' }, { slug: 'place-italy', name: 'Italy' }],
      feature_image: G + 'size/w2000/flo-1.jpg', feature_image_alt: 'The Duomo at dusk',
      html: `<figure class="kg-card"><img src="${G}size/w1200/flo-1.jpg" alt="dup"></figure><figure><img src="${G}flo-2.jpg" alt=""><figcaption>Ponte Vecchio</figcaption></figure>` },
    { slug: 'journey-out-west-the-people', title: 'Journey Out West: The People', url: 'https://studios.test/people/', tags: [{ slug: 'travel', name: 'Travel' }],
      feature_image: G + 'people-1.jpg', html: '' },
  ];
  let fetched = [];
  const fetchImpl = async url => {
    fetched.push(url);
    if (url.includes('/ghost/api/')) return { ok: true, json: async () => ({ posts }) };
    const name = url.split('/').pop();
    if (!imgs[name]) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => imgs[name] };
  };
  process.env.GHOST_CONTENT_API = 'https://studios.test/ghost/api/content';
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, fetchImpl });
  const { db, sync } = app.locals;

  assert.deepStrictEqual(photosIn(posts[0]).map(p => p.src), [G + 'flo-1.jpg', G + 'flo-2.jpg'], 'resized copies collapse to one original');
  const r1 = await sync.run();
  assert.deepStrictEqual([r1.added, r1.held_private, r1.failed], [2, 1, 0], JSON.stringify(r1));
  assert.ok(fetched.includes(G + 'flo-1_o.jpg'), 'prefers the untouched upload');
  const works = db.prepare('SELECT slug,title,status,place,caption,credit FROM works ORDER BY id').all();
  assert.strictEqual(works[0].title, 'The Duomo at dusk');
  assert.strictEqual(works[1].title, 'Florence, No. 2');
  assert.strictEqual(works[1].caption, 'Ponte Vecchio');
  assert.strictEqual(works[0].place, 'Florence, Italy');
  assert.strictEqual(works[2].status, 'hidden', 'people-led story held privately');
  const rooms = db.prepare('SELECT slug, public FROM collections ORDER BY sort').all();
  assert.deepStrictEqual(rooms, [{ slug: 'florence', public: 1 }, { slug: 'journey-out-west-the-people', public: 0 }]);
  const r2 = await sync.run();
  assert.deepStrictEqual([r2.added, r2.held_private, r2.known], [0, 0, 3], 'second run adds nothing');
  const ledger = db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.registered'").get();
  assert.strictEqual(ledger.n, 3, 'each on the ledger once');
  console.log('ok: studios sync');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
