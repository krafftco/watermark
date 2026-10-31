'use strict';
// Vincent (31 Oct, Will: "the perfect figure of the struggling artist whose work could never be shown to the world;
// Watermark and solve what Van Gogh went through"). A room of what is free for everyone: his paintings, in
// public-domain photographs (Wikimedia Commons; a faithful photograph of a public-domain painting carries no new
// right), and his letters to Theo (Project Gutenberg, the 1912 translation). Every painting open (no sale, no licence),
// credited, and pointing to where the original hangs. Nothing here claims or implies any tie to the Van Gogh Museum
// or the Vincent van Gogh Foundation; the room says so in plain words.
// The paintings come in under the house's own shelf for open work, the maker 'the-public-domain' (kind institution),
// linked to the artist Vincent van Gogh (art.js); the room keeps a wall of them in the order they were painted, so
// Wander walks them (/wander?in=hang:vincent-van-gogh).
// Studio: POST /studio/vangogh/bring makes the shelf if missing, queues the Commons feeds (featured pictures first,
// then the Google Art Project files) as public domain and shown, and shelves the letters (Gutenberg 40393).
const FEEDS = [
  ['Vincent van Gogh: featured pictures (Commons)', 'https://commons.wikimedia.org/wiki/Category:Featured_pictures_of_paintings_by_Vincent_van_Gogh'],
  ['Vincent van Gogh: Google Art Project (Commons)', 'https://commons.wikimedia.org/wiki/Category:Google_Art_Project_works_by_Vincent_van_Gogh'],
];
const LETTERS = 40393; // The Letters of a Post-Impressionist (1912)
const HANG = 'vincent-van-gogh';

function mountVanGogh(app, { db, V, studioOnly, isStudio }) {
  const { esc, tidy } = V;
  const artist = () => { try { return db.prepare("SELECT * FROM artists WHERE lower(name) LIKE '%van gogh%' ORDER BY id LIMIT 1").get() || null; } catch (e) { return null; } };
  const shelf = () => db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get();
  function ensureShelf() {
    let m = shelf(); if (m) return m;
    db.prepare("INSERT INTO makers (handle, name, kind, house, bio, joined_at, door) VALUES ('the-public-domain', 'The public domain', 'institution', 'Open to everyone', 'Works whose makers died long ago and that belong now to everyone: shown here free, credited, never sold.', datetime('now'), 'house')").run();
    return shelf();
  }
  const year = w => { const m = String(w.taken_at || '').match(/(18[5-9]\d)/) || String(w.caption || w.title || '').match(/\b(18[5-9]\d)\b/); return m ? +m[1] : null; };
  function works() {
    const a = artist(); if (!a) return [];
    return db.prepare("SELECT * FROM works WHERE artist_id=? AND status='held' ORDER BY COALESCE(taken_at, ''), id").all(a.id)
      .map(w => ({ ...w, y: year(w) })).sort((x, y) => (x.y || 9999) - (y.y || 9999) || x.id - y.id);
  }
  // The wall Wander walks: the paintings in the order they were made, hung by the house, public.
  function wall(ws) {
    const H = app.locals.hangs; if (!H || !H.houseBuyer) return null; const hb = H.houseBuyer(); if (!hb || !ws.length) return null;
    let h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(HANG);
    if (!h) { db.prepare("INSERT INTO hangs (buyer_id, slug, title, line, public) VALUES (?,?,?,?,1)").run(hb.id, HANG, 'Vincent van Gogh', 'The paintings, in the order he made them.'); h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(HANG); }
    const have = new Set(db.prepare('SELECT work_id FROM hang_works WHERE hang_id=?').all(h.id).map(r => r.work_id));
    ws.forEach((w, i) => { if (!have.has(w.id)) db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,?)').run(h.id, w.id, i); else db.prepare('UPDATE hang_works SET pos=? WHERE hang_id=? AND work_id=?').run(i, h.id, w.id); });
    return h;
  }
  const PERIODS = [[1853, 1885, 'The Netherlands', 'Etten, The Hague, Drenthe, Nuenen: dark earth, weavers, peasants, The Potato Eaters.'], [1886, 1887, 'Paris', 'Two years with Theo in Montmartre; the palette breaks open.'], [1888, 1888, 'Arles', 'The south, the Yellow House, the sunflowers, Gauguin, the ear.'], [1889, 1889, 'Saint-Rémy', 'The asylum garden, the cypresses, the olive groves, The Starry Night.'], [1890, 1890, 'Auvers-sur-Oise', 'Seventy days, some seventy paintings, and the wheat field.']];
  let cache = { at: 0, html: '' };
  app.get(['/vangogh', '/van-gogh', '/vincent'], (req, res) => {
    if (Date.now() - cache.at < 60e3 && !isStudio(req)) return res.send(cache.html);
    const ws = works(); const h = wall(ws);
    const hero = ws.find(w => /starry night/i.test(w.title)) || ws.find(w => /self-portrait/i.test(w.title)) || ws[0];
    const book = db.prepare("SELECT * FROM texts WHERE (source LIKE ? OR lower(title) LIKE '%post-impressionist%') AND public=1 LIMIT 1").get(`%/${LETTERS}%`);
    const groups = PERIODS.map(([a, b, name, line]) => ({ name, line, list: ws.filter(w => w.y && w.y >= a && w.y <= b) })).filter(g => g.list.length);
    const undated = ws.filter(w => !w.y);
    const where = w => { try { const m = (w.caption || '').match(/(Van Gogh Museum|Kröller-Müller|Museum of Modern Art|Metropolitan Museum|National Gallery[^.;,]*|Art Institute of Chicago|Musée d'Orsay|Cleveland Museum of Art|Baltimore Museum of Art|Rijksmuseum|Courtauld[^.;,]*)/i); return m ? m[1] : ''; } catch (e) { return ''; } };
    const plate = w => `<figure class="vg-w"><a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><figcaption><b>${esc(tidy(w.title))}</b>${w.y ? `<span>${w.y}</span>` : ''}${where(w) ? `<i>${esc(where(w))}</i>` : ''}</figcaption></figure>`;
    const wander = h ? `/wander?in=hang:${HANG}` : '/wander';
    const html = V.layout({ title: 'Vincent van Gogh · Watermark', bare: true, desc: 'His paintings and his letters to Theo, free for everyone, in the order he made them.', path: '/vangogh', image: hero ? `/img/${hero.slug}/screen` : null, body: `<main class="vg">
<header class="vg-h">${hero ? `<figure class="vg-hero"><img src="/img/${esc(hero.slug)}/large" alt="${esc(tidy(hero.title))}"></figure>` : ''}<div class="vg-ht"><p class="k">A room of the house</p><h1>Vincent van Gogh</h1><p class="vg-dates">1853 &ndash; 1890</p>
<p class="vg-lede">He made some nine hundred paintings in about ten years and sold almost none of them while he lived. His brother Theo kept him going; after both brothers had died, Theo&rsquo;s widow, Jo van Gogh-Bonger, spent her life getting the work seen.</p>
<p class="vg-lede">This room holds what now belongs to everyone: the paintings, in public-domain photographs, and the letters he wrote to Theo. The originals hang in museums; each painting says where.</p>
<p class="vg-acts"><a class="vg-wander" href="${wander}">${V.WAVE_MARK || ''}<span>Wander the paintings</span><i>One at a time, in the order he made them</i></a>${book ? `<a class="vg-read" href="/read/${esc(book.slug)}"><span>Read his letters to Theo</span><i>${esc(tidy(book.title))}</i></a>` : ''}</p></div></header>
${ws.length ? groups.map(g => `<section class="vg-p"><h2>${esc(g.name)}</h2><p class="vg-pl">${esc(g.line)}</p><div class="vg-grid">${g.list.map(plate).join('')}</div></section>`).join('') + (undated.length ? `<section class="vg-p"><h2>Undated here</h2><div class="vg-grid">${undated.map(plate).join('')}</div></section>` : '') : '<p class="vg-empty">The paintings are coming in.</p>'}
<section class="vg-why"><h2>Why this room is here</h2><p>Watermark is built so that the next Vincent is seen, credited and paid while living: the work held safe from the first day, shown to anyone who looks, and the money from every sale going to the person who made it, every Friday.</p><p><a href="/join">Keep your own work here</a></p></section>
<footer class="vg-foot"><p>Photographs of public-domain paintings from Wikimedia Commons; the letters from Project Gutenberg. Free to look at and to take, credited, never sold. Watermark has no connection with the Van Gogh Museum or the Vincent van Gogh Foundation; to see the paintings themselves, go to the museums that keep them.</p></footer></main>` });
    if (!isStudio(req)) cache = { at: Date.now(), html };
    res.send(html);
  });
  app.post('/studio/vangogh/bring', studioOnly, async (req, res) => {
    const m = ensureShelf(); const out = { feeds: [], book: null };
    try { if (app.locals.art) app.locals.art.ensure('Vincent van Gogh', { born: 1853, died: 1890, nationality: 'Dutch', movement: 'Post-Impressionism' }); } catch (e) { /* */ }
    const F = app.locals.feeds;
    if (F) for (const [name, url] of FEEDS) { if (!db.prepare('SELECT 1 FROM feeds WHERE url=? AND status NOT IN (\'failed\',\'stopped\')').get(url)) { try { out.feeds.push(F.enqueue({ name, url, kind: 'commons', maker: m.handle, open: 'pd', show: '1', max: '400' })); } catch (e) { out.feeds.push(String(e.message)); } } }
    const R = app.locals.reading;
    if (R && R.bring) { try { const t = await R.bring(LETTERS); out.book = t && (t.slug || t.id) || null; } catch (e) { out.book = String(e.message); } }
    cache.at = 0;
    res.json({ ok: true, ...out });
  });
  app.locals.vangogh = { works, wall };
}
module.exports = { mountVanGogh };
