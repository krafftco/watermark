// At auction (Will, 10 Nov: "for them to be delighted by an app like Watermark"; "let's do that for the pieces that
// they have; I will go back tomorrow and get high resolution images"). A work that is coming to sale, kept the way
// the house keeps any work: large, with its story and its place in the artist's life, and one door out to the
// auction house, where the bidding is. The house sells nothing here and takes nothing.
//   /auction                 the lots on view: coming, by sale; then what was sold
//   /auction/:slug           one lot: the picture (a held work: the house's own or an open photograph, never the
//                            auction house's), the facts of the sale, the way out to bid, the artist, more by them
//   /studio/auction          the desk: record a lot (the link and the facts, by hand), hang a photograph on it by
//                            the work's slug, show or hide it, record the result
// Facts of a sale (house, date, lot, estimate, result) are free to state. Their photographs and their words are
// theirs: nothing is fetched from an auction house's site. Never an endorsement: every page says the house is not
// connected with the auction house. Counsel reads it before it is advertised.
const STATES = { coming: 'Coming to sale', sold: 'Sold', passed: 'Not sold', withdrawn: 'Withdrawn' };

function mountAuction(app, { db, V, studioOnly }) {
  const { esc } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS auction_lots (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, house TEXT NOT NULL, sale TEXT, sale_at TEXT, city TEXT, lot_no TEXT, url TEXT,
    artist TEXT, artist_id INTEGER, title TEXT NOT NULL, made TEXT, medium TEXT, dims TEXT, est_low INTEGER, est_high INTEGER, currency TEXT NOT NULL DEFAULT 'usd', result INTEGER,
    status TEXT NOT NULL DEFAULT 'coming', work_id INTEGER, line TEXT, provenance TEXT, shown INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec('CREATE INDEX IF NOT EXISTS auction_lots_work ON auction_lots (work_id)');

  const slugify = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'lot';
  const clean = (s, n = 300) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const long = (s, n = 4000) => String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, n);
  const cents = s => { const n = Number(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return n > 0 ? Math.round(n * 100) : null; };
  const httpsOnly = u => { try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' ? x.href.slice(0, 600) : null; } catch (e) { return null; } };
  const cur = c => (/^[a-z]{3}$/i.test(String(c || '')) ? String(c).toLowerCase() : 'usd');
  const money = (c, k) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur(k).toUpperCase(), maximumFractionDigits: 0 }).format(c / 100);
  const dayOf = s => { const d = s ? new Date(String(s).slice(0, 10) + 'T12:00:00Z') : null; return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
  const estimate = l => l.est_low && l.est_high ? `${money(l.est_low, l.currency)} – ${money(l.est_high, l.currency)}` : l.est_low ? `From ${money(l.est_low, l.currency)}` : l.est_high ? `Up to ${money(l.est_high, l.currency)}` : '';
  const workOf = l => (l.work_id ? db.prepare("SELECT id, slug, title, width, height, status, keep_back, zone FROM works WHERE id=? AND status='held' AND COALESCE(keep_back,0)=0").get(l.work_id) : null);
  const artistOf = l => (l.artist_id ? db.prepare('SELECT id, slug, name, born, died FROM artists WHERE id=?').get(l.artist_id) : null);
  const bySlug = s => db.prepare('SELECT * FROM auction_lots WHERE slug=?').get(String(s || ''));
  const shownLots = () => db.prepare("SELECT * FROM auction_lots WHERE shown=1 ORDER BY CASE status WHEN 'coming' THEN 0 ELSE 1 END, COALESCE(sale_at,'9999') , house, id LIMIT 400").all();
  const pic = (l, size) => { const w = workOf(l); return w && w.zone !== 'mature' ? `/img/${esc(w.slug)}/${size}` : null; };
  const notOurs = l => `Watermark is not connected with ${esc(l.house)}. The sale is theirs: the estimate, the conditions and the bidding are on their page.`;

  function fieldsOf(b) {
    return { house: clean(b.house, 80), sale: clean(b.sale, 200), sale_at: /^\d{4}-\d{2}-\d{2}$/.test(String(b.sale_at || '')) ? b.sale_at : null, city: clean(b.city, 80), lot_no: clean(b.lot_no, 20), url: httpsOnly(b.url),
      artist: clean(b.artist, 160), title: clean(b.title, 240), made: clean(b.made, 60), medium: clean(b.medium, 200), dims: clean(b.dims, 160), est_low: cents(b.est_low), est_high: cents(b.est_high), currency: cur(b.currency),
      line: long(b.line, 1200), provenance: long(b.provenance, 4000) };
  }
  function linkArtist(name) { try { return name && app.locals.art ? (app.locals.art.ensure(name) || {}).id || null : null; } catch (e) { return null; } }
  function linkWork(s) { const slug = String(s || '').trim().replace(/^.*\/(?:w|m\/[^/]+)\//, '').replace(/[?#].*$/, ''); if (!slug) return null; const w = db.prepare('SELECT id FROM works WHERE slug=?').get(slug); return w ? w.id : null; }
  function create(b) {
    const f = fieldsOf(b); if (!f.house || !f.title) return null;
    let slug = slugify([f.artist, f.title].filter(Boolean).join(' ')); let n = 1; while (bySlug(slug)) slug = `${slugify([f.artist, f.title].filter(Boolean).join(' ')).slice(0, 74)}-${++n}`;
    const r = db.prepare('INSERT INTO auction_lots (slug, house, sale, sale_at, city, lot_no, url, artist, artist_id, title, made, medium, dims, est_low, est_high, currency, line, provenance, work_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(slug, f.house, f.sale, f.sale_at, f.city, f.lot_no, f.url, f.artist, linkArtist(f.artist), f.title, f.made, f.medium, f.dims, f.est_low, f.est_high, f.currency, f.line, f.provenance, linkWork(b.work));
    return db.prepare('SELECT * FROM auction_lots WHERE id=?').get(r.lastInsertRowid);
  }

  // On a work's own page: the lot it is.
  function line(w) {
    try { const l = db.prepare("SELECT * FROM auction_lots WHERE work_id=? AND shown=1 ORDER BY id DESC LIMIT 1").get(w.id); if (!l) return '';
      return `<p class="auc-line"><a href="/auction/${esc(l.slug)}">${l.status === 'coming' ? 'Coming to sale' : esc(STATES[l.status] || 'At auction')} at ${esc(l.house)}${l.sale_at ? `, ${esc(dayOf(l.sale_at))}` : ''}</a><span>the lot, and the way to bid</span></p>`; } catch (e) { return ''; }
  }

  const card = l => { const p = pic(l, 'screen'); return `<a class="auc-c${p ? '' : ' auc-plain'}" href="/auction/${esc(l.slug)}">${p ? `<img src="${p}" alt="" loading="lazy">` : ''}<span class="auc-ct"><small>${esc(l.artist || '')}</small><b>${esc(l.title)}</b><em>${l.status === 'coming' ? esc(estimate(l) ? `Estimate ${estimate(l)}` : 'Coming to sale') : l.status === 'sold' && l.result ? `Sold for ${money(l.result, l.currency)}` : esc(STATES[l.status] || '')}</em></span></a>`; };

  app.get('/auction', (req, res) => {
    const lots = shownLots(); const coming = lots.filter(l => l.status === 'coming'); const past = lots.filter(l => l.status !== 'coming');
    const sales = new Map(); for (const l of coming) { const k = [l.house, l.sale, l.sale_at].join('|'); if (!sales.has(k)) sales.set(k, { l, list: [] }); sales.get(k).list.push(l); }
    res.send(V.layout({ title: 'At auction · Watermark', path: '/auction', desc: 'Works coming to sale, shown whole, with their story and the way to bid.', body: `<section class="auc">
<header class="auc-h"><p class="k">At auction</p><h1>Before the hammer.</h1><p class="auc-lede">Works coming to sale, shown whole and at rest: who made them, where they sit in a life’s work, and the way to the room where they are sold. The house sells nothing here.</p></header>
${coming.length ? [...sales.values()].map(s => `<h2>${esc(s.l.house)}${s.l.sale ? ` · ${esc(s.l.sale)}` : ''}</h2><p class="auc-when">${esc([dayOf(s.l.sale_at), s.l.city].filter(Boolean).join(' · '))}</p><div class="auc-g">${s.list.map(card).join('')}</div>`).join('') : '<p class="auc-none">Nothing is coming to sale on these walls just now.</p>'}
${past.length ? `<h2>Sold, and remembered</h2><div class="auc-g auc-g-s">${past.map(card).join('')}</div>` : ''}
<p class="auc-fine">Watermark is not connected with any auction house named here. Estimates and results are the auction houses’ own, stated as facts; photographs are the house’s own or open ones. Nothing here is advice on what to bid.</p>
</section>` }));
  });

  app.get('/auction/:slug', (req, res, next) => {
    const l = bySlug(req.params.slug); if (!l || (!l.shown && !(req.cookies && req.cookies.wm_s))) return next();
    const w = workOf(l), a = artistOf(l), big = pic(l, 'large'), est = estimate(l);
    const more = a ? db.prepare("SELECT slug, title FROM works WHERE artist_id=? AND status='held' AND COALESCE(keep_back,0)=0 AND COALESCE(zone,'all')<>'mature' AND id<>? ORDER BY curated DESC, stars DESC, id LIMIT 8").all(a.id, w ? w.id : 0) : [];
    const facts = [['Made', l.made], ['Medium', l.medium], ['Size', l.dims]].filter(x => x[1]);
    const sale = [['Sale', l.sale], ['When', [dayOf(l.sale_at), l.city].filter(Boolean).join(' · ')], ['Lot', l.lot_no], ['Estimate', l.status === 'coming' || !l.result ? est : ''], ['Result', l.status === 'sold' && l.result ? money(l.result, l.currency) : l.status !== 'coming' ? STATES[l.status] : '']].filter(x => x[1]);
    const dl = rows => `<dl class="auc-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    res.send(V.layout({ title: `${l.title}${l.artist ? `, ${l.artist}` : ''} · At auction · Watermark`, path: '/auction', desc: `${l.artist ? `${l.artist}, ` : ''}${l.title}. ${l.status === 'coming' ? 'Coming to sale' : STATES[l.status] || ''} at ${l.house}${l.sale_at ? `, ${dayOf(l.sale_at)}` : ''}.`, image: w ? `/img/${w.slug}/large?f=jpg` : undefined, body: `<article class="auc auc-lot">
${l.shown ? '' : '<p class="ok">Not shown yet: only the Studio sees this page.</p>'}
<p class="auc-crumb"><a href="/auction">At auction</a> · ${esc(l.house)}</p>
<div class="auc-two">
<figure class="auc-fig">${big ? `<a href="/w/${esc(w.slug)}"><img src="${big}" alt="${esc(l.title)}"></a>` : '<div class="auc-nopic">No photograph on these walls yet.</div>'}</figure>
<div class="auc-side">
<p class="auc-state">${esc(STATES[l.status] || '')} · ${esc(l.house)}</p>
${l.artist ? `<p class="auc-art">${a ? `<a href="/art/${esc(a.slug)}">${esc(l.artist)}</a>` : esc(l.artist)}${a && (a.born || a.died) ? ` <span>(${esc([a.born, a.died].filter(Boolean).join('–'))})</span>` : ''}</p>` : ''}
<h1>${esc(l.title)}</h1>
${facts.length ? dl(facts) : ''}
${l.line ? `<div class="auc-words">${l.line.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
<div class="auc-sale"><h2>The sale</h2>${dl(sale)}
${l.url ? `<a class="auc-out" href="${esc(l.url)}" rel="noopener nofollow" target="_blank">${l.status === 'coming' ? `Bid at ${esc(l.house)}` : `The lot at ${esc(l.house)}`} &rarr;</a>` : ''}
<p class="auc-fine">${notOurs(l)}</p></div>
<p class="auc-acts">${w ? `<a href="/w/${esc(w.slug)}">The work’s own page</a> <a href="/easel/${esc(w.slug)}?back=/auction/${esc(l.slug)}">Study it</a>` : ''}${a ? ` <a href="/art/${esc(a.slug)}">${esc(a.name)}: the whole life’s work</a>` : ''} <a href="#" data-send data-send-title="${esc(l.title)}" data-send-url="/auction/${esc(l.slug)}">Share</a></p>
</div></div>
${l.provenance ? `<section class="auc-prov"><h2>Provenance</h2>${l.provenance.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
${more.length ? `<section class="auc-more"><h2>More by ${esc(a.name)}</h2><div class="auc-strip">${more.map(m => `<a href="/w/${esc(m.slug)}"><img src="/img/${esc(m.slug)}/thumb" alt="${esc(m.title || '')}" loading="lazy"></a>`).join('')}</div></section>` : ''}
</article>` }));
  });

  // The desk.
  const F = (l = {}) => `<label>The lot’s address<input name="url" type="url" value="${esc(l.url || '')}" placeholder="https://www.sothebys.com/…"></label>
<div class="auc-row"><label>Auction house<input name="house" required value="${esc(l.house || '')}" placeholder="Sotheby’s"></label><label>Sale<input name="sale" value="${esc(l.sale || '')}" placeholder="Modern Evening Auction"></label><label>Date<input name="sale_at" type="date" value="${esc(l.sale_at || '')}"></label><label>City<input name="city" value="${esc(l.city || '')}" placeholder="New York"></label><label>Lot<input name="lot_no" value="${esc(l.lot_no || '')}"></label></div>
<div class="auc-row"><label>Artist<input name="artist" value="${esc(l.artist || '')}"></label><label>Title<input name="title" required value="${esc(l.title || '')}"></label><label>Made<input name="made" value="${esc(l.made || '')}" placeholder="1887"></label></div>
<div class="auc-row"><label>Medium<input name="medium" value="${esc(l.medium || '')}"></label><label>Size<input name="dims" value="${esc(l.dims || '')}"></label></div>
<div class="auc-row"><label>Estimate, low<input name="est_low" inputmode="numeric" value="${l.est_low ? l.est_low / 100 : ''}"></label><label>Estimate, high<input name="est_high" inputmode="numeric" value="${l.est_high ? l.est_high / 100 : ''}"></label><label>Currency<input name="currency" value="${esc(l.currency || 'usd')}" size="4"></label></div>
<label>The photograph: a work in the house, by its address or slug<input name="work" value="${esc(l.work_slug || '')}" placeholder="/w/the-work or its slug"></label>
<label>The house’s words (your own, never the catalogue’s)<textarea name="line" rows="3">${esc(l.line || '')}</textarea></label>
<label>Provenance, a line each (facts, in your own words)<textarea name="provenance" rows="3">${esc(l.provenance || '')}</textarea></label>`;

  app.get('/studio/auction', studioOnly, (req, res) => {
    const lots = db.prepare('SELECT l.*, w.slug AS work_slug FROM auction_lots l LEFT JOIN works w ON w.id=l.work_id ORDER BY l.id DESC LIMIT 300').all();
    const edit = req.query.edit ? lots.find(l => String(l.id) === String(req.query.edit)) : null;
    res.send(V.layout({ studio: true, title: 'At auction · Studio', path: '/studio/auction', body: `<section class="auc auc-dk"><h1>At auction</h1>
<p>Record a lot by hand: the link and the facts. Hang one of the house’s own photographs on it (put the photograph in the vault first, with the artist’s name), then show it. Nothing is taken from the auction house’s page.</p>
${req.query.ok ? `<p class="ok">${esc({ made: 'Recorded. Not shown yet.', saved: 'Saved.', shown: 'On view.', hidden: 'Taken off view.', gone: 'Removed.', bad: 'It needs an auction house and a title.' }[req.query.ok] || '')}</p>` : ''}
<form class="auc-f" method="post" action="${edit ? `/studio/auction/${edit.id}` : '/studio/auction'}"><h2>${edit ? `Edit: ${esc(edit.title)}` : 'Record a lot'}</h2>${F(edit || {})}
${edit ? `<div class="auc-row"><label>State<select name="status">${Object.entries(STATES).map(([k, v]) => `<option value="${k}"${edit.status === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label><label>Result (the price realised)<input name="result" inputmode="numeric" value="${edit.result ? edit.result / 100 : ''}"></label></div>` : ''}
<button type="submit" name="do" value="save">${edit ? 'Save' : 'Record it'}</button>${edit ? ' <a href="/studio/auction">Cancel</a>' : ''}</form>
<h2>The lots</h2>${lots.length ? `<table class="tbl"><tbody>${lots.map(l => `<tr><td>${l.work_slug ? `<img src="/img/${esc(l.work_slug)}/thumb" alt="" width="56" height="42" style="object-fit:cover">` : ''}</td><td><a href="/auction/${esc(l.slug)}"><b>${esc(l.title)}</b></a><br><small>${esc([l.artist, l.house, dayOf(l.sale_at), estimate(l)].filter(Boolean).join(' · '))}</small></td><td>${l.shown ? 'On view' : 'Not shown'} · ${esc(STATES[l.status] || '')}${l.work_slug ? '' : '<br><small>no photograph</small>'}</td>
<td><a href="/studio/auction?edit=${l.id}">Edit</a> <form method="post" action="/studio/auction/${l.id}" style="display:inline"><button name="do" value="${l.shown ? 'hide' : 'show'}">${l.shown ? 'Take off view' : 'Show it'}</button> <button name="do" value="drop">Remove</button></form></td></tr>`).join('')}</tbody></table>` : '<p>None yet.</p>'}
</section>` }));
  });
  app.post('/studio/auction', studioOnly, (req, res) => { const l = create(req.body || {}); res.redirect(303, `/studio/auction?ok=${l ? 'made' : 'bad'}`); });
  app.post('/studio/auction/:id', studioOnly, (req, res) => {
    const l = db.prepare('SELECT * FROM auction_lots WHERE id=?').get(req.params.id); if (!l) return res.sendStatus(404); const b = req.body || {};
    if (b.do === 'show' || b.do === 'hide') { db.prepare('UPDATE auction_lots SET shown=? WHERE id=?').run(b.do === 'show' ? 1 : 0, l.id); return res.redirect(303, `/studio/auction?ok=${b.do === 'show' ? 'shown' : 'hidden'}`); }
    if (b.do === 'drop') { db.prepare('DELETE FROM auction_lots WHERE id=?').run(l.id); return res.redirect(303, '/studio/auction?ok=gone'); }
    const f = fieldsOf(b); if (!f.house || !f.title) return res.redirect(303, '/studio/auction?ok=bad');
    db.prepare('UPDATE auction_lots SET house=?, sale=?, sale_at=?, city=?, lot_no=?, url=?, artist=?, artist_id=?, title=?, made=?, medium=?, dims=?, est_low=?, est_high=?, currency=?, line=?, provenance=?, work_id=?, status=?, result=? WHERE id=?')
      .run(f.house, f.sale, f.sale_at, f.city, f.lot_no, f.url, f.artist, linkArtist(f.artist), f.title, f.made, f.medium, f.dims, f.est_low, f.est_high, f.currency, f.line, f.provenance, linkWork(b.work), STATES[b.status] ? b.status : l.status, cents(b.result), l.id);
    res.redirect(303, '/studio/auction?ok=saved');
  });

  app.locals.auction = { create, line, bySlug, estimate, STATES };
}
module.exports = { mountAuction };
