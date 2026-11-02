'use strict';
// The scout (Will, 2 Nov: "build a viewer for me to look into these collections; how can we know what we want to bring
// over"; "someday we will have all of the museums' APIs connected"). Look before bringing: a museum's open collection
// searched where it lives, shown as a wall of thumbnails with the record and the rights on each, what the house already
// holds marked, a tick on what is worth keeping, and one press to bring the chosen in through the feeds (kind 'picked':
// the items themselves, so nothing is searched twice and a restart resumes). Nothing is fetched at full size until it is
// chosen. Every source is read into the IIIF importer's item shape, so one door takes them all.
// Sources (keyless, open access): the Met (CC0), the Art Institute of Chicago (CC0, IIIF), the Cleveland Museum of Art
// (CC0). More are a reader each: SOURCES is the list.
const SOURCES = {
  met: { name: 'The Metropolitan Museum of Art', short: 'The Met', site: 'https://www.metmuseum.org', rights: 'cc0' },
  aic: { name: 'The Art Institute of Chicago', short: 'Art Institute of Chicago', site: 'https://www.artic.edu', rights: 'cc0' },
  cma: { name: 'The Cleveland Museum of Art', short: 'Cleveland', site: 'https://www.clevelandart.org', rights: 'cc0' },
};
const PER = 24;
const yr = v => { const m = String(v == null ? '' : v).match(/-?\d{3,4}/); return m && +m[0] > 0 && +m[0] < 2100 ? +m[0] : null; };
const kindOf = s => { s = String(s || ''); return /paint/i.test(s) ? 'painting' : /sculpt/i.test(s) ? 'sculpture' : /drawing/i.test(s) ? 'drawing' : /print|etching|woodcut|lithograph|engraving/i.test(s) ? 'print' : /photograph/i.test(s) ? 'photograph' : /textile/i.test(s) ? 'textile' : null; };
const metaOf = pairs => pairs.filter(([, v]) => v != null && String(v).trim()).map(([label, value]) => ({ label, value: String(value) }));

function mountScout(app, { db, V, studioOnly, isStudio }) {
  const { esc } = V;
  const doFetch = (u, o) => app.locals.iiif.doFetch(u, o);
  const json = async u => { const r = await doFetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${new URL(u).host} ${r.status}`); return r.json(); };
  const cache = new Map(); // a search page, for ten minutes; the museums are not asked twice for one look
  const cached = async (k, fn) => { const c = cache.get(k); if (c && c.at > Date.now() - 600000) return c.v; const v = await fn(); cache.set(k, { at: Date.now(), v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; };

  async function met({ q, page, highlight, onview }) {
    const u = new URL('https://collectionapi.metmuseum.org/public/collection/v1.1/search');
    u.searchParams.set('q', q || '*'); u.searchParams.set('hasImages', 'true'); u.searchParams.set('isPublicDomain', 'true');
    if (highlight) u.searchParams.set('isHighlight', 'true'); if (onview) u.searchParams.set('isOnView', 'true');
    u.searchParams.set('offset', String((page - 1) * PER)); u.searchParams.set('limit', String(PER));
    let j; try { j = await json(u.href); } catch (e) { if (!/ 400$/.test(e.message)) throw e; u.searchParams.delete('isPublicDomain'); j = await json(u.href); }
    const ids = j.objectIDs || [];
    const objs = []; for (let i = 0; i < ids.length; i += 6) objs.push(...await Promise.all(ids.slice(i, i + 6).map(id => json(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null))));
    const items = objs.filter(o => o && o.primaryImage).map(o => ({
      id: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`, label: o.title || 'Untitled', thumb: o.primaryImageSmall || o.primaryImage, image: o.primaryImage, open: !!o.isPublicDomain, rights: o.isPublicDomain ? 'cc0' : 'closed',
      by: o.artistDisplayName || o.culture || '', date: o.objectDate || '', medium: o.medium || '', where: o.department || '', highlight: !!o.isHighlight, onview: !!o.GalleryNumber,
      summary: [o.artistDisplayName, o.objectDate].filter(Boolean).join(', '), kind: kindOf(o.classification || o.medium),
      meta: metaOf([['Artist', o.artistDisplayName], ['Date', o.objectDate], ['Medium', o.medium], ['Dimensions', o.dimensions], ['Credit line', o.creditLine], ['Department', o.department], ['Accession number', o.accessionNumber], ['Culture', o.culture], ['Place', [o.city, o.country].filter(Boolean).join(', ')], ['Gallery', o.GalleryNumber ? `Gallery ${o.GalleryNumber}` : '']]),
      artist: o.artistDisplayName ? { name: o.artistDisplayName, born: yr(o.artistBeginDate), died: yr(o.artistEndDate), nationality: o.artistNationality || null } : null }));
    return { total: +j.total || 0, items };
  }
  async function aic({ q, page, onview }) {
    const u = new URL('https://api.artic.edu/api/v1/artworks/search');
    if (q) u.searchParams.set('q', q); u.searchParams.set('query[term][is_public_domain]', 'true'); if (onview) u.searchParams.set('query[term][is_on_view]', 'true');
    u.searchParams.set('limit', String(PER)); u.searchParams.set('page', String(page));
    u.searchParams.set('fields', 'id,title,artist_title,artist_display,date_display,date_start,date_end,medium_display,dimensions,image_id,is_public_domain,is_on_view,classification_title,credit_line,place_of_origin,main_reference_number,department_title,artwork_type_title');
    const j = await json(u.href); const base = (j.config && j.config.iiif_url) || 'https://www.artic.edu/iiif/2';
    const items = (j.data || []).filter(o => o.image_id).map(o => ({
      id: `https://www.artic.edu/artworks/${o.id}`, label: o.title || 'Untitled', thumb: `${base}/${o.image_id}/full/400,/0/default.jpg`, image: `${base}/${o.image_id}/full/max/0/default.jpg`, open: !!o.is_public_domain, rights: o.is_public_domain ? 'cc0' : 'closed',
      by: o.artist_title || '', date: o.date_display || '', medium: o.medium_display || '', where: o.department_title || '', onview: !!o.is_on_view,
      summary: [o.artist_title, o.date_display].filter(Boolean).join(', '), kind: kindOf(o.artwork_type_title || o.classification_title || o.medium_display),
      meta: metaOf([['Artist', o.artist_title], ['Date', o.date_display || o.date_start], ['Medium', o.medium_display], ['Dimensions', o.dimensions], ['Credit line', o.credit_line], ['Department', o.department_title], ['Accession number', o.main_reference_number], ['Place', o.place_of_origin]]),
      artist: o.artist_title ? { name: o.artist_title } : null }));
    return { total: +((j.pagination || {}).total) || 0, items };
  }
  async function cma({ q, page, highlight, onview }) {
    const u = new URL('https://openaccess-api.clevelandart.org/api/artworks/');
    if (q) u.searchParams.set('q', q); u.searchParams.set('cc0', '1'); u.searchParams.set('has_image', '1');
    if (highlight) u.searchParams.set('highlight', '1'); if (onview) u.searchParams.set('currently_on_view', '1');
    u.searchParams.set('limit', String(PER)); u.searchParams.set('skip', String((page - 1) * PER));
    const j = await json(u.href);
    const items = (j.data || []).filter(o => o.images && (o.images.web || o.images.print)).map(o => {
      const cr = (o.creators || [])[0] || {}; const name = String(cr.description || '').replace(/\s*\(.*$/, '').trim();
      return { id: o.url || `https://www.clevelandart.org/art/${o.accession_number}`, label: o.title || 'Untitled', thumb: (o.images.web || o.images.print).url, image: ((o.images.full || o.images.print || o.images.web) || {}).url, open: o.share_license_status === 'CC0', rights: o.share_license_status === 'CC0' ? 'cc0' : 'closed',
        by: name || o.culture && o.culture[0] || '', date: o.creation_date || '', medium: o.technique || '', where: o.department || '', highlight: !!o.is_highlight, onview: !!o.current_location,
        summary: [name, o.creation_date].filter(Boolean).join(', '), kind: kindOf(o.type || o.technique),
        meta: metaOf([['Artist', name], ['Date', o.creation_date], ['Medium', o.technique], ['Dimensions', o.measurements], ['Credit line', o.creditline], ['Department', o.department], ['Accession number', o.accession_number], ['Culture', (o.culture || [])[0]]]),
        artist: name ? { name, born: yr(cr.birth_year), died: yr(cr.death_year), nationality: cr.nationality || null } : null };
    });
    return { total: +((j.info || {}).total) || 0, items };
  }
  const READ = { met, aic, cma };
  async function search(src, o) {
    const p = { q: String(o.q || '').trim().slice(0, 120), page: Math.max(1, Math.min(400, +o.page || 1)), highlight: !!o.highlight, onview: !!o.onview };
    const r = await cached(`${src}|${JSON.stringify(p)}`, () => READ[src](p));
    const ids = r.items.map(i => i.id); const held = new Map();
    if (ids.length) for (const w of db.prepare(`SELECT slug, source_url, status FROM works WHERE source_url IN (${ids.map(() => '?').join(',')})`).all(...ids)) held.set(w.source_url, w);
    return { ...r, page: p.page, per: PER, items: r.items.map(i => ({ ...i, held: held.has(i.id) ? held.get(i.id).slug : null })) };
  }

  app.get('/studio/scout/api', studioOnly, async (req, res) => {
    const src = READ[req.query.src] ? req.query.src : 'met';
    try { res.json(await search(src, req.query)); } catch (e) { res.status(502).json({ error: `The museum did not answer (${e.message}).` }); }
  });
  app.post('/studio/scout/bring', studioOnly, require('express').json({ type: 'application/x-watermark-scout+json', limit: '8mb' }), (req, res) => {
    const b = req.body || {}; const F = app.locals.feeds; if (!F || !F.enqueuePicked) return res.status(503).json({ error: 'feeds are not mounted' });
    try { const src = SOURCES[b.src] || null; const id = F.enqueuePicked({ maker: b.maker, show: b.show ? 1 : 0, open: src ? src.rights : null, name: `${src ? src.short : 'A museum'}: ${(b.items || []).length} chosen in the scout${b.q ? ` (${String(b.q).slice(0, 40)})` : ''}` }, b.items); res.json({ ok: true, feed: id, href: `/studio/feeds/${id}` }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/studio/scout', studioOnly, (req, res) => {
    const makers = db.prepare("SELECT id, name, handle, kind FROM makers WHERE standing IS NULL OR standing<>'held' ORDER BY CASE kind WHEN 'institution' THEN 0 ELSE 1 END, name").all();
    const pre = makers.find(m => m.handle === 'museum-demo') || makers.find(m => m.kind === 'institution' && m.handle !== 'the-public-domain') || makers.find(m => m.kind !== 'printer') || makers[0];
    res.send(V.layout({ title: 'The scout · Studio', path: '/studio/scout', desc: '', studio: true, body: `<main class="sct" data-sct>
<header class="sct-h"><p class="k">The Studio · Bringing in</p><h1>The scout.</h1><p class="lede">Look into a museum’s open collection where it lives. Tick what is worth keeping; nothing is fetched at full size until it is chosen. What the house already holds is marked.</p></header>
<form class="sct-f" data-sct-f><div class="sct-src">${Object.entries(SOURCES).map(([k, s], i) => `<label><input type="radio" name="src" value="${k}"${i ? '' : ' checked'}> ${esc(s.short)}</label>`).join('')}</div>
<input name="q" type="search" placeholder="A word, an artist, a place: Vermeer, Hokusai, Venice" autocomplete="off"><label class="sct-ck"><input type="checkbox" name="highlight" value="1" checked> Highlights</label><label class="sct-ck"><input type="checkbox" name="onview" value="1"> On view</label><button class="buy-btn">Look</button></form>
<p class="sct-n" data-sct-n></p><div class="sct-g" data-sct-g></div><nav class="sct-pg" data-sct-pg></nav>
<div class="sct-bar" data-sct-bar hidden><span data-sct-c></span><button type="button" class="link" data-sct-all>Tick this page</button><button type="button" class="link" data-sct-none>Clear</button>
<select data-sct-maker>${makers.map(m => `<option value="${m.id}"${pre && m.id === pre.id ? ' selected' : ''}>${esc(m.name)}${m.kind && m.kind !== 'maker' ? ` (${esc(m.kind)})` : ''}</option>`).join('')}</select><label class="sct-ck"><input type="checkbox" data-sct-show checked> Show at once</label><button type="button" class="buy-btn" data-sct-go>Bring them in</button></div>
<dialog class="sct-d" data-sct-d><button type="button" class="sct-x" data-sct-x>Close</button><img alt=""><div class="sct-dm"></div></dialog>
</main><script src="/static/scout.js?v=${(process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 8)}" defer></script>` }));
  });
  app.locals.scout = { search, SOURCES, READ };
}
module.exports = { mountScout, SOURCES };
