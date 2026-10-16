// Studios → Watermark. Every photograph published on Krafft Studios is held on Watermark:
// the original is fetched once, fingerprinted, sealed in the vault, written to the ledger and hung
// in a room named after its story. New stories are picked up on the next run (every six hours).
//
// Licensing stays clean: places, landscapes and travel go up publicly and licensable; stories built
// around people (portraits, profiles) or other artists' work are held privately until a release
// exists, and can be opened one by one in Studio.
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = process.env.GHOST_CONTENT_API || 'https://krafftstudios.ghost.io/ghost/api/content';
// Ghost's Content API key is public by design (read-only, published posts only).
const KEY = process.env.GHOST_CONTENT_KEY || '8198cc66daa230f254acfaf9d5';

// Stories that may be licensed publicly: places and travel, not people or other artists' work.
const PRIVATE_SLUGS = new Set(['journey-out-west-the-people']);
function isPublic(post) {
  const tags = (post.tags || []).map(t => t.slug);
  if (PRIVATE_SLUGS.has(post.slug)) return false;
  if (tags.includes('travel')) return true;
  return ['longhorn-mesa'].includes(post.slug);
}

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };
// The original upload, not a resized copy.
const original = src => src.replace(/\/size\/w\d+(\/format\/\w+)?\//, '/');

// Photographs in a post, in reading order: the feature image, then every <img> in the body.
function photosIn(post) {
  const out = [];
  if (post.feature_image) out.push({ src: post.feature_image, alt: post.feature_image_alt || '', caption: strip(post.feature_image_caption) });
  const html = post.html || '';
  const re = /<figure[\s\S]*?<\/figure>|<img[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const cap = (block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || [])[1];
    const imgs = block.match(/<img[^>]*>/gi) || [];
    imgs.forEach(tag => out.push({ src: attr(tag, 'src'), alt: attr(tag, 'alt'), caption: imgs.length === 1 ? strip(cap) : '' }));
  }
  const seen = new Set();
  return out
    .filter(p => /\/content\/images\//.test(p.src) && /\.(jpe?g|png|webp)(\?|$)/i.test(p.src))
    .map(p => ({ ...p, src: original(p.src.split('?')[0]) }))
    .filter(p => !seen.has(p.src) && seen.add(p.src));
}

function placeOf(post) {
  const country = (post.tags || []).find(t => t.slug.startsWith('place-'));
  const city = post.title.replace(/^Journey Out (East|West):?\s*/, '').trim();
  if (!country) return city || null;
  return city && city !== country.name ? `${city}, ${country.name}` : country.name;
}

async function fetchTo(url, fetchImpl) {
  // Ghost keeps the untouched upload beside the web copy as name_o.ext; prefer it.
  const o = url.replace(/(\.[a-z]+)$/i, '_o$1');
  for (const u of [o, url]) {
    const r = await fetchImpl(u);
    if (!r.ok) continue;
    const file = path.join(os.tmpdir(), `wm-sync-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(url) || '.jpg'}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }
  throw new Error('not found: ' + url);
}

function createSync({ db, registerWork, slugify, log = console.log, fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS studios_imports (
    src TEXT PRIMARY KEY, work_id INTEGER, post_slug TEXT, outcome TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  let running = false;

  function room(post, publicRoom, sort) {
    let c = db.prepare('SELECT * FROM collections WHERE slug=?').get(post.slug);
    if (!c) {
      db.prepare('INSERT INTO collections (slug,title,note,public,sort) VALUES (?,?,?,?,?)')
        .run(post.slug, post.title, post.custom_excerpt || post.excerpt?.slice(0, 400) || null, publicRoom ? 1 : 0, sort);
      c = db.prepare('SELECT * FROM collections WHERE slug=?').get(post.slug);
    }
    return c;
  }

  async function run({ limit = Infinity } = {}) {
    if (running) return { skipped: true };
    running = true;
    const done = { added: 0, held_private: 0, known: 0, failed: 0 };
    try {
      const r = await fetchImpl(`${API}/posts/?key=${KEY}&limit=all&include=tags&formats=html&order=published_at%20asc`);
      if (!r.ok) throw new Error(`Studios API ${r.status}`);
      const { posts = [] } = await r.json();
      let sort = 0;
      for (const post of posts) {
        const pub = isPublic(post);
        const photos = photosIn(post);
        if (!photos.length) continue;
        const c = room(post, pub, ++sort);
        let n = 0;
        for (const p of photos) {
          n++;
          if (done.added + done.held_private >= limit) return done;
          if (db.prepare('SELECT 1 FROM studios_imports WHERE src=?').get(p.src)) { done.known++; continue; }
          let file;
          try {
            file = await fetchTo(p.src, fetchImpl);
            const title = (p.alt && p.alt.length > 3 && !/^(image|photo|img)\b/i.test(p.alt)) ? p.alt.slice(0, 160) : `${post.title}, No. ${n}`;
            const w = await registerWork({ file, originalName: path.basename(p.src), title, place: placeOf(post), caption: p.caption || null, source_url: post.url });
            db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id, sort) VALUES (?,?,?)').run(c.id, w.id, n);
            db.prepare("UPDATE works SET credit=COALESCE(credit, 'Krafft Studios'), keywords=COALESCE(keywords, ?) WHERE id=?").run((post.tags || []).map(t => t.name).join(', ') || null, w.id);
            if (!pub) db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id);
            db.prepare('INSERT INTO studios_imports (src, work_id, post_slug, outcome) VALUES (?,?,?,?)').run(p.src, w.id, post.slug, pub ? 'public' : 'private');
            pub ? done.added++ : done.held_private++;
          } catch (e) {
            if (file && fs.existsSync(file)) fs.unlinkSync(file);
            const dupe = /already held as "([^"]+)"/.exec(e.message || '');
            if (dupe) {
              const w = db.prepare('SELECT id FROM works WHERE slug=?').get(dupe[1]);
              db.prepare('INSERT OR IGNORE INTO studios_imports (src, work_id, post_slug, outcome) VALUES (?,?,?,?)').run(p.src, w ? w.id : null, post.slug, 'duplicate');
              if (w) db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id, sort) VALUES (?,?,?)').run(c.id, w.id, n);
              done.known++;
            } else { done.failed++; log('[studios-sync] failed', p.src, e.message); }
          }
        }
      }
      return done;
    } finally {
      running = false;
      log('[studios-sync]', JSON.stringify(done));
    }
  }
  return { run, isRunning: () => running };
}

module.exports = { createSync, photosIn, isPublic, placeOf };
