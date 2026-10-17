// Alexandria. Some of what hangs here is free and clear: in the public domain, or given by its maker under a
// Creative Commons licence. It is held like everything else (fingerprinted, on the register, conserved), shown
// like everything else, and taken by anyone for nothing, with the credit the licence asks for. A museum's
// open-access collection belongs on this shelf; its licensed work beside it, at the source.
const fs = require('fs');
const path = require('path');
const { layout, esc, tidy } = require('./views');

const OPEN = {
  pd: { name: 'Public domain', short: 'PD', url: 'https://creativecommons.org/publicdomain/mark/1.0/', says: 'No copyright. Use it for anything; credit is a courtesy.' },
  cc0: { name: 'CC0', short: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', says: 'The maker has given it to the world. Use it for anything; credit is a courtesy.' },
  'cc-by': { name: 'CC BY 4.0', short: 'CC BY', url: 'https://creativecommons.org/licenses/by/4.0/', says: 'Use it for anything, with the maker credited.' },
  'cc-by-sa': { name: 'CC BY-SA 4.0', short: 'CC BY-SA', url: 'https://creativecommons.org/licenses/by-sa/4.0/', says: 'Use it for anything, with the maker credited; share what you make from it alike.' },
  'cc-by-nc': { name: 'CC BY-NC 4.0', short: 'CC BY-NC', url: 'https://creativecommons.org/licenses/by-nc/4.0/', says: 'Use it for anything that is not commercial, with the maker credited. For a commercial use, license it here.' },
};
const credit = (w, maker) => `${tidy(w.title)}, ${maker.name}${w.taken_at ? `, ${String(w.taken_at).slice(0, 4)}` : ''}. ${OPEN[w.open] ? OPEN[w.open].name : ''}${maker.kind === 'institution' ? '' : ' · via Watermark'}`.trim();

function mountOpen(app, { db, V, mk, originalPath, images, cache, ledger, isStudio, makerOf }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='open'").get()) db.exec('ALTER TABLE works ADD COLUMN open TEXT');
  const openWorks = () => db.prepare("SELECT w.*, m.name AS maker_name, m.kind AS maker_kind, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.open IS NOT NULL ORDER BY m.kind='institution' DESC, m.name, w.stars DESC, w.id DESC").all();
  app.locals.openOf = w => (w && w.open && OPEN[w.open] ? { key: w.open, ...OPEN[w.open], credit: credit(w, mk(w)) } : null);

  // The shelf.
  app.get('/open', (req, res) => {
    const all = openWorks();
    const by = new Map(); for (const w of all) { if (!by.has(w.maker_id)) by.set(w.maker_id, { name: w.maker_name, kind: w.maker_kind, handle: w.handle, slug: V.makerSlug({ handle: w.handle, name: w.maker_name }), works: [] }); by.get(w.maker_id).works.push(w); }
    res.send(V.openShelf({ groups: [...by.values()], n: all.length, OPEN }));
  });
  // Taking a free-and-clear original: no key, no count, the credit line in the file's name; recorded on the register as taken, not licensed.
  app.get('/open/:slug/take', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w || !w.open || !OPEN[w.open]) return res.sendStatus(404);
    let file; try { file = await originalPath(w); } catch (e) { return res.sendStatus(503); }
    ledger.append(db, 'open.taken', w.slug, { licence: w.open });
    const name = `${w.slug}-${OPEN[w.open].short.toLowerCase().replace(/\s+/g, '-')}${path.extname(w.original_file) || '.jpg'}`;
    // Free and clear still carries the mark: the maker, the licence and the way back, and a mark unique to the taking.
    if (app.locals.mark && /\.(jpe?g|png|tiff?)$/i.test(file)) {
      try {
        const dlId = Number(db.prepare("INSERT INTO downloads (license_id, seat_id, size) VALUES (0, NULL, 'open')").run().lastInsertRowid);
        const fmt = /\.png$/i.test(file) ? 'png' : /\.tiff?$/i.test(file) ? 'tiff' : 'jpeg';
        const buf = await app.locals.mark.marked(fs.readFileSync(file), { w, maker: mk(w), ref: null, licensee: null, use: OPEN[w.open].name, dlId, format: fmt });
        res.set('Content-Disposition', `attachment; filename="${name}"`); return res.type(fmt === 'png' ? 'png' : fmt === 'tiff' ? 'tiff' : 'jpg').send(buf);
      } catch (e) { console.error('[open mark]', e.message); }
    }
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.type(/\.png$/i.test(file) ? 'image/png' : /\.tiff?$/i.test(file) ? 'image/tiff' : 'image/jpeg');
    fs.createReadStream(file).pipe(res);
  });
  // The maker (or the Studio) sets a work free and clear, or takes it back for new uses (what was taken stays taken).
  app.post(['/account/works/:slug/open', '/studio/works/:slug/open'], (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    const m = makerOf(req); if (!(isStudio(req) || (m && m.id === w.maker_id))) return res.sendStatus(401);
    const k = String((req.body || {}).open || ''); const v = OPEN[k] ? k : null;
    db.prepare('UPDATE works SET open=? WHERE id=?').run(v, w.id);
    ledger.append(db, v ? 'work.opened' : 'work.closed', w.slug, { licence: v });
    res.redirect(`${req.path.startsWith('/account') ? '/account/works' : '/studio/works'}/${w.slug}?ok=${encodeURIComponent(v ? `Free and clear: ${OPEN[v].name}.` : 'Licensed at the source again; nothing already taken is undone.')}`);
  });
  app.locals.OPEN = OPEN;
  return { OPEN, openWorks };
}

function openShelf({ groups, n, OPEN }) {
  const plate = w => `<a class="pl" href="/w/${esc(w.slug)}" style="--r:${(w.width && w.height ? w.width / w.height : 1.5).toFixed(3)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"><span class="pc"><b>${esc(tidy(w.title))}</b><i>${esc(OPEN[w.open].short)}</i></span></a>`;
  return layout({ title: 'Free and clear · Watermark', desc: 'Photographs in the public domain or given under Creative Commons: beautiful, held and conserved here, yours to use.', path: '/open', body: `<section class="cx-intro op-intro"><p class="k">Free and clear</p><h1>Alexandria.</h1>
<p class="lede">Some of what hangs here belongs to everyone: photographs in the public domain, and work their makers have given under a Creative Commons licence. Held like everything else, fingerprinted, on the register, conserved; and yours to take at full resolution for nothing, with the credit the licence asks for. ${n ? `${n} photograph${n === 1 ? '' : 's'} so far.` : 'The first are on their way.'}</p>
<p class="note">Licences on this shelf: ${Object.values(OPEN).map(o => `<a href="${o.url}" rel="noopener">${esc(o.name)}</a>`).join(' · ')}. A museum or a library with an open-access collection: <a href="/join">write to the house</a>.</p></section>
${groups.map(g => `<section class="gal"><header class="gh"><h2><a href="/m/${esc(g.slug)}">${esc(g.name)}</a>${g.kind === 'institution' ? ' <small class="op-inst">Institution</small>' : ''}</h2><span>${g.works.length}</span></header><div class="plates">${g.works.map(plate).join('')}</div></section>`).join('')}` });
}

module.exports = { mountOpen, openShelf, OPEN };
