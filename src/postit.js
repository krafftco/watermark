// Post it (5 Nov): Instagram as the house's billboard. Any work on view, made ready for a post (1080 × 1350, 4:5) or a
// story (1080 × 1920): the picture whole on the dark wall, never cropped, its title and who made it beneath, and the
// address that leads back. The device's share sheet hands it to Instagram; the link to the work is copied first, so a
// story can carry it as a link sticker. Nothing kept back, nothing behind a door, nothing private is ever made a card.
const fs = require('fs'); const path = require('path');

function mountPostIt(app, { db, V, images, cache, originalPath }) {
  const host = () => { try { return new URL(process.env.BASE_URL || 'https://watermark.krafftco.com').host; } catch (e) { return 'watermark.krafftco.com'; } };
  const e = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Who made it, as a person says it: the artist for a museum's work, else the maker.
  const byOf = w => {
    const m = db.prepare('SELECT name, kind FROM makers WHERE id=?').get(w.maker_id) || {};
    if (w.artist_id) { const a = db.prepare('SELECT name, born, died FROM artists WHERE id=?').get(w.artist_id); if (a && (m.kind === 'institution' || m.kind === 'company')) return a.name; }
    return m.name || '';
  };
  const lineOf = w => {
    const y = w.taken_at ? String(w.taken_at).slice(0, 4) : '';
    return [byOf(w), [w.place, /^\d{4}$/.test(y) ? y : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  };
  // The address on the card: the maker's link in bio when the maker is a person, else the house.
  const footOf = w => { const m = db.prepare('SELECT handle, kind FROM makers WHERE id=?').get(w.maker_id) || {}; return m.handle && (m.kind || 'maker') === 'maker' ? `${host()}/@${m.handle}` : host(); };
  // Long words are cut, never run off the card.
  const fit = (t, n) => { t = String(t || ''); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };
  const may = (req, w) => w && w.status === 'held' && !w.keep_back && !(w.zone === 'mature' && !(app.locals.zone && app.locals.zone.open(req)));

  async function card(w, kind) {
    const post = kind === 'post';
    const out = path.join(cache, `${kind}-${w.slug}-${(w.sha256 || '').slice(0, 10)}-c2.jpg`);
    if (fs.existsSync(out)) return out;
    const sharp = require('sharp');
    const src = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg');
    const W = 1080, H = post ? 1350 : 1920, boxW = post ? 960 : 980, boxH = post ? 1000 : 1360;
    const pic = await sharp(src).resize(boxW, boxH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
    const textH = 170, block = pic.info.height + textH;
    const top = Math.round(post ? (H - block) / 2 - 10 : Math.max(150, (H - block) / 2 - 40)), left = Math.round((W - pic.info.width) / 2);
    const y1 = top + pic.info.height + 72, y2 = y1 + 46, yf = H - (post ? 46 : 340); // a story's foot clears Instagram's reply bar
    const title = fit(V.tidy ? V.tidy(w.title) : w.title, 44), line = fit(lineOf(w), 60);
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
      + `<text x="${W / 2}" y="${y1}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="42" fill="#efe9df">${e(title)}</text>`
      + `<text x="${W / 2}" y="${y2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#b9b1a4">${e(line)}</text>`
      + `<text x="${W / 2}" y="${yf}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="5" fill="#8f877b">${e(footOf(w).toUpperCase())}</text>`
      + `</svg>`;
    const tmp = `${out}.${process.pid}.tmp`;
    await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0a09' } })
      .composite([{ input: pic.data, left, top }, { input: Buffer.from(svg), left: 0, top: 0 }])
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(tmp);
    try { fs.renameSync(tmp, out); } catch (er) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } }
    return out;
  }

  app.get(['/w/:slug/post.jpg', '/w/:slug/story.jpg'], async (req, res) => {
    const kind = req.path.endsWith('/post.jpg') ? 'post' : 'story';
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug));
    if (!may(req, w)) return res.sendStatus(404);
    try {
      const f = await card(w, kind);
      const name = `${String(V.tidy ? V.tidy(w.title) : w.title).replace(/[^\w .,'-]+/g, ' ').trim() || 'Watermark'} (${kind}).jpg`;
      res.set('Cache-Control', w.zone === 'mature' ? 'private, max-age=3600' : 'public, max-age=3600');
      if (req.query.dl) res.set('Content-Disposition', `attachment; filename="${name}"`);
      res.type('image/jpeg').sendFile(f);
    } catch (er) { console.error('[post it]', kind, w.slug, er.message); res.sendStatus(500); }
  });
  // The link in bio (5 Nov): watermark…/@handle, the one address a maker puts on Instagram. Made for the phone that
  // taps it from a profile: their face, their name, one line, Wander their work, the work itself, and the doors
  // (collect, commission, subscribe, their whole page). Opens on the work, not on a form.
  const makerBy = h => {
    h = String(h || '').toLowerCase().replace(/^@/, '');
    let m = db.prepare("SELECT * FROM makers WHERE lower(handle)=? AND COALESCE(standing,'open')<>'held'").get(h);
    if (!m) m = db.prepare("SELECT * FROM makers WHERE COALESCE(standing,'open')<>'held'").all().find(x => V.makerSlug(x) === h) || null;
    return m;
  };
  const worksOf = (m, n) => db.prepare("SELECT slug, title, width, height, place, taken_at, zone FROM works WHERE maker_id=? AND status='held' AND COALESCE(keep_back,0)=0 AND COALESCE(zone,'all')='all' ORDER BY curated DESC, COALESCE(stars,0) DESC, id DESC LIMIT ?").all(m.id, n);
  const bioUrl = m => `${(process.env.BASE_URL || 'https://watermark.krafftco.com').replace(/\/$/, '')}/@${m.handle}`;
  app.get(/^\/@([A-Za-z0-9_.-]{1,64})\/?$/, (req, res, next) => {
    const m = makerBy(req.params[0]); if (!m) return next();
    const ws = worksOf(m, 12); const hero = ws[0];
    const first = String(m.name || '').split(/\s+/)[0];
    const bio = String(m.bio || '').split(/(?<=[.!?])\s+/)[0].slice(0, 220);
    const life = V.lifeOf ? V.lifeOf(m) : '';
    const page = `/m/${encodeURIComponent(V.makerSlug(m))}`;
    const doors = [
      [`/wander?maker=${encodeURIComponent(m.handle)}`, `Wander ${e(first)}'s work`, 1],
      hero ? [`/w/${encodeURIComponent(hero.slug)}?from=bio#collect`, 'Collect a piece', 0] : null,
      [`/brands?to=${encodeURIComponent(m.handle)}`, `Commission ${e(first)}`, 0],
      [`${page}#gazette`, 'Get the letters', 0],
      [page, 'The whole page', 0]
    ].filter(Boolean);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(V.layout({ title: `${m.name} · Watermark`, bare: true, desc: bio || `${m.name} keeps their work on Watermark.`, image: hero ? `/w/${hero.slug}/post.jpg` : undefined,
      body: `<main class="lnb">${hero ? `<a class="lnb-hero" href="/wander?maker=${encodeURIComponent(m.handle)}&amp;at=${encodeURIComponent(hero.slug)}"><img src="/img/${e(hero.slug)}/screen" alt="${e(V.tidy(hero.title))}"></a>` : ''}
<header class="lnb-who">${m.portrait ? `<img class="lnb-por" src="/portrait/${e(m.handle)}" alt="">` : ''}<h1>${e(m.name)}</h1>${life ? `<p class="lnb-life">${life}</p>` : ''}${bio ? `<p class="lnb-bio">${e(bio)}</p>` : ''}</header>
<nav class="lnb-doors">${doors.map(([h, t, gold]) => `<a class="lnb-d${gold ? ' lnb-g' : ''}" href="${h}">${t}</a>`).join('')}</nav>
${ws.length > 1 ? `<section class="lnb-grid" aria-label="The work">${ws.slice(1, 10).map(w => `<a href="/wander?maker=${encodeURIComponent(m.handle)}&amp;at=${encodeURIComponent(w.slug)}"><img loading="lazy" src="/img/${e(w.slug)}/thumb" alt="${e(V.tidy(w.title))}"></a>`).join('')}</section>` : ''}
<footer class="lnb-f"><a href="/">Watermark</a> · where great work is kept · <a href="/join">Keep your own work here</a></footer></main>` }));
  });

  // The maker's own room for it: the link to put in their bio, and every work ready as a post or a story.
  app.get('/account/billboard', (req, res) => {
    const m = app.locals.accounts && app.locals.accounts.makerOf(req); if (!m) return res.redirect('/signin?next=/account/billboard');
    const ws = worksOf(m, 60); const url = bioUrl(m);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Instagram · Watermark', path: '/account/billboard',
      body: `<article class="bbd"><p class="k">Your page and store</p><h1>Instagram, as your billboard.</h1>
<p class="lede">Post the work there; keep it here. Every post leads people back to where they can see it whole, collect it, and pay you.</p>
<section class="bbd-link"><h2>1 · The link in your bio</h2><p>Put this in your Instagram bio. It opens on your work, on any phone.</p>
<div class="bbd-u"><input readonly value="${e(url)}" aria-label="Your link"><button type="button" data-send="1" data-send-url="${e(url)}" data-send-title="${e(m.name)} on Watermark">Copy or share</button></div>
<p class="bbd-h">On Instagram: Edit profile → Links → Add external link → paste it. <a href="/@${e(m.handle)}">See it as they will</a>.</p></section>
<section class="bbd-posts"><h2>2 · Post the work</h2><p>Tap a work, then Post (4:5) or Story. The card carries the picture whole, its title, your name and the address; on a phone it goes straight to Instagram, and the work's link is copied for the caption or a story's link sticker.</p>
${ws.length ? `<div class="bbd-grid">${ws.map(w => `<button type="button" class="bbd-w" data-wm-send="${e(w.slug)}" data-send-title="${e(V.tidy(w.title))}" data-send-by="${e(m.name)}"><img loading="lazy" src="/img/${e(w.slug)}/thumb" alt=""><span>${e(V.tidy(w.title))}</span></button>`).join('')}</div>` : `<p>Nothing on view yet. <a href="/account/upload">Put your work in</a>, then hang it, and it appears here ready to post.</p>`}</section>
<section class="bbd-why"><h2>3 · Why it works</h2><p>Instagram is where people are. Watermark is where the work is kept, owned and paid for. Every post you make is a door back to your page, where you keep the full price and are paid on Friday.</p></section></article>` }));
  });
  app.locals.postIt = { card, may, bioUrl };
}
module.exports = { mountPostIt };
