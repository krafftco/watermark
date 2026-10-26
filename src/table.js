// The Library (Will, 25 Oct: "make working with your photos and work so much easier, in terms of mass selecting
// and publishing"; "world class"; "how would Adobe do it; this needs to take from Lightroom Classic and mobile").
// Lightroom's Library module, brought to the house: a Grid of the maker's work with a Loupe (E, space), flags
// before acts (P pick · X reject · U unflag), stars on the keys (1–5, 0), a filter bar (flags, stars, public or
// private, a word), selection by click, shift-click, ⌘-click and a marquee; on a phone a tap selects and a press
// then a drag sweeps; caps-lock auto-advance for culling; and one act for the whole selection: Publish (the picks,
// or the selection; the attestation asked once a visit), Make private, Stars, Place, Kind; every act through JSON,
// nothing reloads, the tiles repaint, a toast says what happened, Undo takes it back.
//   `works.flag` pick | reject | null. GET /account/table (the room), GET /account/table.json (the works),
//   POST /account/works/batch with json=1 (batch.js answers {ok, msg, works}), do=flag with flag=pick|reject|none.
function mountTable(app, { db, V, C, makerOf, KINDS }) {
  const { esc, tidy } = V;
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='flag'").get()) db.exec('ALTER TABLE works ADD COLUMN flag TEXT');
  const list = m => db.prepare(`SELECT w.slug, w.title, w.place, w.status, w.stars, w.curated, w.flag, w.kind, w.width, w.height, w.taken_at, w.created_at, w.accession,
      (SELECT COUNT(*) FROM licenses l WHERE l.work_id=w.id AND l.status IN ('active','expired') AND l.price_cents>0) AS sold
    FROM works w WHERE w.maker_id=? AND w.status IN ('held','hidden','restoring') ORDER BY COALESCE(w.taken_at, w.created_at) DESC, w.id DESC`).all(m.id)
    .map(w => ({ slug: w.slug, title: tidy(w.title), place: w.place || '', status: w.status === 'held' ? 'public' : w.status === 'hidden' ? 'private' : w.status, stars: w.stars || 0, curated: !!w.curated, flag: w.flag || null, kind: w.kind || 'photograph', w: w.width || 0, h: w.height || 0, at: (w.taken_at || w.created_at || '').slice(0, 10), accession: w.accession || '', sold: w.sold || 0 }));
  app.get('/account/table.json', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); res.set('Cache-Control', 'private, no-store').json({ works: list(m), kinds: KINDS }); });
  app.get('/account/table', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/table');
    V.setDeskPath && V.setDeskPath('/account/table');
    const works = list(m); const places = [...new Set(works.map(w => w.place).filter(Boolean))].sort();
    const DK = app.locals.darkroom; const looks = DK ? DK.LOOKS.map(([key, name]) => ({ key, name })).concat(DK.looksOf(m.handle).map(l => ({ key: 'mine:' + l.id, name: l.name + ' (yours)' }))) : [];
    const I = require('./icons');
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'The Library · Your studio', studio: true, bare: false, body: `<main class="lib" data-lib data-f="${esc(String(req.query.f || ''))}">
<header class="lib-top"><div class="lib-tt"><p class="k">Your studio</p><h1>The Library.</h1></div>
<nav class="lib-filt" aria-label="Filter"><div class="lib-fg" data-lib-flags><button type="button" data-f="all" aria-pressed="true">All</button><button type="button" data-f="pick" title="Flagged as picks (P)">Picks</button><button type="button" data-f="unflagged" title="Not yet flagged">Unflagged</button><button type="button" data-f="reject" title="Rejected (X)">Rejected</button></div>
<div class="lib-fg" data-lib-stars><button type="button" data-s="0" aria-pressed="true">Any stars</button>${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" title="${n} stars and up">${'★'.repeat(n)}<small>+</small></button>`).join('')}</div>
<div class="lib-fg" data-lib-pub><button type="button" data-p="all" aria-pressed="true">Public and private</button><button type="button" data-p="private">Private</button><button type="button" data-p="public">Public</button></div>
<label class="lib-q"><input type="search" placeholder="A word, a place, a title" data-lib-q></label>
<label class="lib-size" title="Thumbnail size"><input type="range" min="2" max="10" value="6" data-lib-size></label></nav>
<p class="lib-line"><span data-lib-count>${works.length} works</span> · <span data-lib-sel>0 selected</span> · <label class="lib-auto"><input type="checkbox" data-lib-auto> Auto-advance after a grade</label> <a class="lib-help" href="#" data-lib-help>Keys</a></p></header>
<div class="lib-grid" data-lib-grid tabindex="0" aria-label="The grid"></div>
<p class="lib-empty" data-lib-empty hidden>Nothing matches.${works.length ? '' : ' <a href="/account/upload">Add work</a>; it stays private until you publish it.'}</p>
<div class="lib-bar" data-lib-bar hidden><span class="lib-bn"><b data-lib-n>0</b> selected</span>
<span class="lib-acts">
<span class="lib-flags"><button type="button" data-act="flag" data-flag="pick" title="Pick (P)">${I.check} Pick</button><button type="button" data-act="flag" data-flag="reject" title="Reject (X)">${I.close} Reject</button><button type="button" data-act="flag" data-flag="none" title="Unflag (U)">Unflag</button></span>
<span class="lib-stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-act="stars" data-stars="${n}" title="${n} stars (${n})">${'★'.repeat(n)}</button>`).join('')}<button type="button" data-act="stars" data-stars="0" title="Clear the grade (0)">0</button></span>
<span class="lib-place"><input placeholder="A place for all of them" data-lib-place list="lib-places"><datalist id="lib-places">${places.map(p => `<option value="${esc(p)}">`).join('')}</datalist><button type="button" data-act="place">Set</button></span>
<select data-lib-kind title="Kind"><option value="">Kind…</option>${(KINDS || []).map(k => `<option value="${esc(k)}">${esc(k[0].toUpperCase() + k.slice(1))}</option>`).join('')}</select>
<span class="lib-look"><select data-lib-look title="A look from the darkroom, over all of them"><option value="">Look…</option>${(looks || []).map(l => `<option value="${esc(l.key)}">${esc(l.name)}</option>`).join('')}</select><button type="button" data-act="look" title="Develop every selected work with this look; each keeps its own crop and masks; the negative is kept">Develop</button></span>
<button type="button" class="link" data-act="hide">Make private</button>
<button type="button" class="buy-btn lib-pub" data-act="publish">Publish</button>
</span>
<button type="button" class="lib-none" data-lib-none title="Select none (Esc)">×</button></div>
<div class="lib-attest" data-lib-attest hidden><label><input type="checkbox" data-lib-attest-cb> I hold the rights to these, and releases for anyone identifiable, and I accept <a href="/legal/makers" target="_blank">the Maker Agreement</a>.</label><button type="button" class="buy-btn" data-lib-attest-go>Publish them</button><button type="button" class="link" data-lib-attest-no>Not now</button></div>
<div class="lib-loupe" data-lib-loupe hidden><img alt="" data-lib-lim><div class="lib-lplate"><b data-lib-lt></b><span data-lib-ll></span><span class="lib-lstars" data-lib-lstars></span></div><button type="button" class="lib-lprev" data-lib-lprev aria-label="Previous">${I.back}</button><button type="button" class="lib-lnext" data-lib-lnext aria-label="Next">${I.next}</button><button type="button" class="lib-lclose" data-lib-lclose aria-label="Close">${I.close}</button><a class="lib-lopen" data-lib-lopen href="#">The record</a></div>
<div class="lib-toast" data-lib-toast hidden><span data-lib-tmsg></span><button type="button" class="link" data-lib-undo hidden>Undo</button></div>
<div class="lib-keys" data-lib-keys hidden><h2>Keys</h2><dl><dt>P · X · U</dt><dd>Pick · Reject · Unflag</dd><dt>1–5 · 0</dt><dd>Stars · clear</dd><dt>E · Space</dt><dd>Loupe (the picture large); ← → walk; Esc back</dd><dt>Click · Shift · ⌘</dt><dd>Select · a run · add one; drag on the wall for a marquee</dd><dt>⌘A · Esc</dt><dd>All shown · none</dd><dt>Enter</dt><dd>Open the record</dd><dt>Caps lock</dt><dd>Auto-advance after a grade</dd></dl><p>On a phone: tap to select, press and drag to sweep, swipe in the loupe.</p><button type="button" class="link" data-lib-keys-close>Close</button></div>
<script>window.__LIB=${JSON.stringify({ works, kinds: KINDS || [] }).replace(/</g, '\\u003c')}</script>
<script src="/static/table.js?v=${esc(V.VER)}" defer></script></main>` }));
  });
  app.locals.table = { list };
  return app.locals.table;
}
module.exports = { mountTable };
