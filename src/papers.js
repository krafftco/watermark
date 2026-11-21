'use strict';
// A maker's working papers (#182; Will, 21 Nov: "take what is good, discard what is bad"). The house already holds the
// record; the papers a working artist needs come out of it, free, as pages to print. No room is added: each paper is a
// printable view that hangs off a room that exists.
//   From the Library (/account/table):
//     /account/table/inventory[.csv]   the inventory, a page of 200 at a time (the Library's own paging and search)
//     /account/table/prices            a price list for a selection: the prices the maker has set, and a blank to write in
//     /account/table/consignment       a consignment sheet for a selection: a form carrying what the maker states
//     /account/table/checklist         a checklist for hanging a selection
//     /account/table/exhibitions       the exhibition history, from the places stated and the loans that came home
//   From a hang (/hang/:id, its curator or the Studio), beside the wall labels that editions.js already prints:
//     /hang/:id/checklist              the checklist for the wall, in its order
//   A selection is the maker's picks in the Library (works.flag = 'pick'), their own works in a hang, or a word
//   (the Library's search). 200 works a sheet at most.
// What is never here: a price the house suggests, a sum, a calculator, a fee, a badge, a rating. A price on a paper is
// one the maker set in the record (the print editions) or writes on the sheet; what is written on a sheet is printed
// and not kept. The consignment sheet is a form, not an agreement the house drew and not legal advice, and says so
// (docs/COUNSEL.md, 50). The house writes no invoice: money goes through Stripe.
// Scale: every list names its columns and carries a LIMIT; what is counted per work is asked once for the works on
// the sheet (`IN (…)`, grouped). The whole archive in one file stays the estate's catalogue (/account/estate).
// EVERY WORD A PERSON READS HERE IS A DRAFT FOR WILL (COPY below, and the column heads).
const DP = require('./deskpage');
const G = require('./grouped');

const SHEET = 200;
const COPY = {
  back: 'The Library',
  print: 'Print',
  papers: 'Papers',
  names: { inventory: 'Inventory', prices: 'Price list', consignment: 'Consignment sheet', checklist: 'Checklist', exhibitions: 'Exhibition history', labels: 'Wall labels' },
  asOf: d => `From the record kept at Watermark, ${d}.`,
  inventoryLede: 'Every work in your record, the newest first: what it is, where it is, how many hold a piece of it, and where it has been shown. Where it is, is yours alone: it is on this paper and on no page a visitor sees.',
  inventoryWhole: 'This is one page of the record. The whole of it, in one file with every picture, is the catalogue in Your estate.',
  pricesLede: 'The works you chose, with the prices you have set for their prints. Write any other price in its line: it is printed, not kept. The house suggests no price.',
  onRequest: 'On request',
  consignLede: 'A sheet to go with works you leave with a gallery or a shop. It carries what you state: write the terms the two of you agreed, print two copies, and sign both.',
  consignNotice: 'This is a form, not legal advice, and Watermark is not a party to what you write on it. The terms are yours and the other person’s. Have a lawyer read any agreement before you sign it.',
  checklistLede: 'The works in the order they hang, with a box to tick as each goes up.',
  exhibitionsLede: 'Where your work has been shown, by year, from what the record holds: the places you have stated on your works and the loans that came home.',
  exhibitionsOnly: 'It lists what is in the record and nothing else. Add a place on a work’s own record, under “Where it can be seen”, and it appears here.',
  none: {
    picks: 'No work is picked yet. In the Library, pick the works you mean (the P key, or Pick), then come back; or choose a hang or a word above.',
    word: q => `Nothing in your record matches “${q}”.`,
    hang: 'None of your own works hang on that wall.',
    inventory: 'There is nothing in your record yet.',
    exhibitions: 'No place is stated on your works yet.',
    checklist: 'Nothing hangs on this wall yet.',
  },
  more: n => `The first ${n} are on this sheet. Narrow the choice with a word, or make a hang, to print the rest.`,
  choose: { head: 'Which works', picks: 'Your picks in the Library', word: 'Or a word', go: 'Choose' },
  consign: {
    parties: 'Between', maker: 'The artist', other: 'The gallery or shop', address: 'Its address', from: 'Left on', until: 'To be returned by',
    terms: 'The terms, as the two of you state them', share: 'Of each sale, the gallery keeps', paid: 'The artist is paid within', insured: 'While there, the works are insured by', carried: 'Carriage there and back is paid by',
    unsold: 'Unsold works', other2: 'Anything else agreed', price: 'Price, as stated', signed: 'Signed', date: 'Date',
  },
  cols: { no: 'No.', title: 'Title', year: 'Year', medium: 'Kind and medium', size: 'Size', edition: 'Edition', where: 'Where it is', held: 'Pieces held', shown: 'Shown', here: 'At Watermark', hung: 'Hung', label: 'Label', notes: 'Notes', maker: 'By', prints: 'Prints, as you priced them', other: 'Other price' },
  here: { held: 'On view', hidden: 'Kept back', restoring: 'Being restored' },
};

const CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body.ppr{margin:0;background:#fff;color:#0b0a09;font:15px/1.45 Georgia,'Times New Roman',serif}
.ppr-bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:10px 20px;background:#f6f3ec;border-bottom:1px solid #d9d3c6;font:14px/1.3 Helvetica,Arial,sans-serif}
.ppr-bar a{color:#0b0a09;display:inline-block;padding:10px 2px;min-height:44px}.ppr-bar a[aria-current]{font-weight:700;text-decoration:none}
.ppr-bar button,.ppr-pick button{font:inherit;min-height:44px;padding:0 18px;border:1px solid #0b0a09;background:#0b0a09;color:#fff;border-radius:2px;cursor:pointer}
.ppr-bar .ppr-sp{flex:1 1 auto}
.ppr-pick{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:end;padding:12px 20px;border-bottom:1px solid #e4dfd3;font:14px/1.3 Helvetica,Arial,sans-serif}
.ppr-pick label{display:grid;gap:4px}.ppr-pick select,.ppr-pick input{font:inherit;min-height:44px;padding:0 10px;border:1px solid #8a8478;border-radius:2px;background:#fff;color:#0b0a09;max-width:100%}
.ppr-sheet{max-width:10.2in;margin:0 auto;padding:28px 20px 60px}
.ppr-k{font:11px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#5c574e;margin:0 0 6px}
.ppr-sheet h1{font:400 30px/1.12 Georgia,serif;margin:0 0 6px}.ppr-sheet h2{font:400 19px/1.2 Georgia,serif;margin:26px 0 8px}
.ppr-by{margin:0 0 4px;font-size:16px}.ppr-of{margin:0 0 14px;color:#5c574e;font-size:13px}
.ppr-lede{margin:0 0 16px;color:#3b372f;max-width:46em}.ppr-note{margin:14px 0;color:#5c574e;font-size:13px;max-width:46em}
.ppr-notice{margin:18px 0;padding:12px 14px;border:1px solid #0b0a09;font-size:14px;max-width:46em}
.ppr-x{overflow-x:auto;-webkit-overflow-scrolling:touch}
.ppr-t{width:100%;border-collapse:collapse;font-size:13px}.ppr-t th{font:11px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5c574e;text-align:left;padding:6px 8px 6px 0;border-bottom:1px solid #0b0a09;vertical-align:bottom}
.ppr-t td{padding:7px 8px 7px 0;border-bottom:1px solid #d9d3c6;vertical-align:top}.ppr-t tr{break-inside:avoid;page-break-inside:avoid}
.ppr-t img{display:block;width:46px;height:46px;object-fit:contain;background:#f1eee7}.ppr-t i{color:#5c574e}
.ppr-t td.ppr-n{white-space:nowrap;color:#5c574e}.ppr-t ul{list-style:none;margin:0;padding:0}
.ppr-box{display:inline-block;width:16px;height:16px;border:1px solid #0b0a09}.ppr-line{display:block;min-width:1.6in;height:1.3em;border-bottom:1px solid #8a8478}
.ppr-in{font:inherit;width:100%;min-width:6em;min-height:34px;border:0;border-bottom:1px solid #8a8478;background:transparent;color:#0b0a09;padding:2px 0;border-radius:0}
textarea.ppr-in{min-height:4.2em;border:1px solid #8a8478;padding:6px}
.ppr-f{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 28px;max-width:46em}.ppr-f label{display:grid;gap:2px;font:12px/1.3 Helvetica,Arial,sans-serif;color:#5c574e}.ppr-f .ppr-w{grid-column:1/-1}
.ppr-sig{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px 40px;margin:40px 0 0;max-width:46em;break-inside:avoid}.ppr-sig div{border-top:1px solid #0b0a09;padding-top:6px;font:12px/1.3 Helvetica,Arial,sans-serif;color:#5c574e}
.ppr-nav{display:flex;gap:20px;margin:18px 0;font:14px Helvetica,Arial,sans-serif}.ppr-nav a{color:#0b0a09;padding:10px 0;min-height:44px;display:inline-block}
.ppr-yr{display:grid;grid-template-columns:4.5em 1fr;gap:4px 14px;margin:0 0 4px;break-inside:avoid}.ppr-yr b{font-weight:400;color:#5c574e}.ppr-yr span{display:block;color:#5c574e;font-size:13px}
.ppr-foot{margin:30px 0 0;color:#5c574e;font-size:12px}
@media(max-width:700px){.ppr-f,.ppr-sig{grid-template-columns:1fr}.ppr-sheet h1{font-size:25px}}
@media print{.ppr-bar,.ppr-pick,.ppr-nav,.ppr-screen{display:none!important}.ppr-sheet{max-width:none;padding:0}.ppr-x{overflow:visible}body.ppr{font-size:11pt}.ppr-t{font-size:9.5pt}.ppr-in{border-bottom:1px solid #8a8478}@page{margin:.6in}.ppr-t img{width:30px;height:30px}.ppr-t td{padding:4px 8px 4px 0}}
@media print{body.ppr-wide{font-size:10pt}}
`;

function mountPapers(app, { db, V, C, makerOf, isStudio }) {
  const { esc, tidy, money } = V;
  const buyerOf = req => (app.locals.buyerOf ? app.locals.buyerOf(req) : null);
  const yearOf = w => (String(w.taken_at || '').match(/^(\d{4})/) || [])[1] || '';
  const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const kindOf = w => { const k = String(w.kind || 'photograph'); return k[0].toUpperCase() + k.slice(1); };
  const mediumOf = w => [kindOf(w), w.medium].filter(Boolean).join(', ');
  const sizeOf = w => w.obj_dims || (w.width && w.height ? `${w.width} × ${w.height} px` : '');
  const editionOf = w => w.obj_edition || (w.edition_size ? `Edition of ${w.edition_size}` : '');
  const COLS = 'w.id, w.slug, w.title, w.taken_at, w.place, w.kind, w.medium, w.accession, w.width, w.height, w.status, w.edition_size, w.obj_dims, w.obj_edition, w.obj_located, w.obj_condition, w.obj_signed';
  const MINE = "w.maker_id=? AND w.status IN ('held','hidden','restoring')";
  const signIn = (req, res) => res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));

  // ---- what is asked once for the works on a sheet
  // Pieces held: collected, numbered pieces that are active. One grouped question.
  const heldOf = ids => { if (!ids.length) return new Map(); const i = G.inList('work_id', ids); return G.safe(() => new Map(db.prepare(`SELECT work_id, COUNT(*) AS n FROM licenses WHERE ${i.sql} AND status='active' AND collector_no IS NOT NULL GROUP BY work_id`).all(...i.args).map(r => [Number(r.work_id), Number(r.n)]))); };
  // Where each has been shown: the places the maker stated (not removed; a past place only when kept as history) and
  // the loans that left. At most 1,000 lines a sheet.
  const span = (a, b) => { const x = String(a || '').slice(0, 4), y = String(b || '').slice(0, 4); return x && y && x !== y ? `${x} to ${y}` : x || y || ''; };
  const day = () => new Date().toISOString().slice(0, 10);
  function shownOf(ids) {
    const out = new Map(); if (!ids.length) return out;
    const put = (id, line) => { id = Number(id); if (!out.has(id)) out.set(id, []); out.get(id).push(line); };
    const i = G.inList('sw.work_id', ids);
    try { for (const r of db.prepare(`SELECT sw.work_id, s.venue, s.city, s.opens_on, s.until_on, s.afterwards FROM onview_works sw JOIN onview_places s ON s.id=sw.showing_id WHERE ${i.sql} AND s.removed_at IS NULL ORDER BY s.id DESC LIMIT 1000`).all(...i.args)) { if (r.until_on && r.until_on < day() && r.afterwards === 'gone') continue; put(r.work_id, [r.venue, r.city, span(r.opens_on, r.until_on)].filter(Boolean).join(', ')); } } catch (e) { /* no places yet */ }
    const j = G.inList('work_id', ids);
    try { for (const r of db.prepare(`SELECT work_id, show_title, venue, city, opens, closes FROM loans WHERE ${j.sql} AND status IN ('out','back','home') ORDER BY id DESC LIMIT 1000`).all(...j.args)) put(r.work_id, [`“${r.show_title}”`, r.venue, r.city, span(r.opens, r.closes)].filter(Boolean).join(', ')); } catch (e) { /* no loans yet */ }
    return out;
  }
  // The print sizes the maker opened on each work, with the prices the maker set. The house's own words for them.
  function printsOf(ids) {
    const out = new Map(); if (!ids.length) return out; const i = G.inList('work_id', ids);
    try { for (const r of db.prepare(`SELECT work_id, label, paper, edition_n, price_cents, framed_cents FROM print_editions WHERE ${i.sql} AND active=1 ORDER BY work_id, sort, id LIMIT 2000`).all(...i.args)) { const id = Number(r.work_id); if (!out.has(id)) out.set(id, []); out.get(id).push(r); } } catch (e) { /* no editions yet */ }
    return out;
  }

  // ---- the page all the papers share (self-contained, as the wall labels are: nothing of the house's shell is printed)
  const KINDS = [['inventory', '/account/table/inventory'], ['prices', '/account/table/prices'], ['consignment', '/account/table/consignment'], ['checklist', '/account/table/checklist'], ['exhibitions', '/account/table/exhibitions']];
  const keepQ = req => { const p = new URLSearchParams(); for (const k of ['from', 'q']) if (req.query[k]) p.set(k, String(req.query[k]).slice(0, 80)); const s = p.toString(); return s ? '?' + s : ''; };
  function sheet(res, { kind, title, m, bar = null, pick = '', body, back = ['/account/table', COPY.back], req }) {
    const wide = kind === 'inventory' || kind === 'checklist'; // ten columns: printed across the long side
    const links = bar || KINDS.map(([k, h]) => `<a href="${h}${k === 'inventory' || k === 'exhibitions' || !req ? '' : esc(keepQ(req))}"${k === kind ? ' aria-current="page"' : ''}>${COPY.names[k]}</a>`).join('');
    res.set('Cache-Control', 'private, no-store');
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Watermark</title><style>${CSS}${wide ? '@page{size:landscape}' : ''}</style></head>
<body class="ppr${wide ? ' ppr-wide' : ''}"><nav class="ppr-bar" aria-label="${COPY.papers}"><a href="${esc(back[0])}">&larr; ${esc(back[1])}</a>${links}<span class="ppr-sp"></span><button type="button" onclick="window.print()">${COPY.print}</button></nav>${pick}
<main class="ppr-sheet"><p class="ppr-k">${esc(COPY.names[kind] || title)}</p>${body}<p class="ppr-foot">${esc(COPY.asOf(today()))}${m ? ` ${esc(C.base.replace(/^https?:\/\//, ''))}/m/${esc(V.makerSlug ? V.makerSlug(m) : m.handle)}` : ''}</p></main></body></html>`);
  }
  const head = (m, h1, of) => `<h1>${esc(h1)}</h1><p class="ppr-by">${esc(m.name)}</p>${of ? `<p class="ppr-of">${esc(of)}</p>` : ''}`;
  const thumb = w => `<img src="/img/${esc(w.slug)}/thumb" alt="" width="46" height="46" onerror="this.style.visibility='hidden'">`;
  const titleCell = w => `<b>${esc(tidy(w.title) || 'Untitled')}</b>${w.accession ? `<br><i>${esc(w.accession)}</i>` : ''}`;

  // ---- a selection: the maker's own works in a hang, a word, or the picks. { works, label, more, why }
  const hangOf = id => db.prepare('SELECT id, buyer_id, slug, title, public, venue, opens_at, closes_at FROM hangs WHERE id=?').get(+id);
  const curates = (req, h) => { if (isStudio(req)) return true; const b = buyerOf(req); return !!(b && h.buyer_id === b.id); };
  const myHangs = req => { const b = buyerOf(req); if (!b) return []; try { return db.prepare('SELECT id, title FROM hangs WHERE buyer_id=? ORDER BY id DESC LIMIT 50').all(b.id); } catch (e) { return []; } };
  function chosen(req, m) {
    const from = String(req.query.from || ''), at = DP.where({ q: req.query.q }); const hm = from.match(/^hang:(\d+)$/);
    if (hm) {
      const h = hangOf(hm[1]);
      if (h && (Number(h.public) === 1 || curates(req, h))) {
        const rows = db.prepare(`SELECT ${COLS} FROM works w JOIN hang_works hw ON hw.work_id=w.id WHERE hw.hang_id=? AND ${MINE} ORDER BY hw.pos, w.id LIMIT ${SHEET + 1}`).all(h.id, m.id);
        const more = rows.length > SHEET; if (more) rows.length = SHEET;
        return { works: rows, label: tidy(h.title), more, why: COPY.none.hang, hang: h };
      }
    }
    if (at.toks.length) { const pg = DP.page(db, { cols: COLS, base: MINE, params: [m.id], at, limit: SHEET }); return { works: pg.rows, label: `“${at.q}”`, more: !!pg.older, why: COPY.none.word(at.q) }; }
    const pg = DP.page(db, { cols: COLS, base: `${MINE} AND w.flag='pick'`, params: [m.id], at: DP.where({}), limit: SHEET });
    return { works: pg.rows, label: COPY.choose.picks, more: !!pg.older, why: COPY.none.picks };
  }
  const picker = (req, path) => { const hs = myHangs(req), from = String(req.query.from || '');
    return `<form class="ppr-pick" method="get" action="${path}"><label><span>${COPY.choose.head}</span><select name="from"><option value="">${COPY.choose.picks}</option>${hs.map(h => `<option value="hang:${h.id}"${from === `hang:${h.id}` ? ' selected' : ''}>${esc(tidy(h.title))}</option>`).join('')}</select></label><label><span>${COPY.choose.word}</span><input type="search" name="q" value="${esc(String(req.query.q || '').slice(0, 80))}" autocomplete="off"></label><button>${COPY.choose.go}</button></form>`; };
  const empty = why => `<p class="ppr-note">${esc(why)}</p>`;
  const tail = S => (S.more ? `<p class="ppr-note ppr-screen">${esc(COPY.more(SHEET))}</p>` : '');

  // ---- the inventory: a page of the record at a time
  function inventory(req, m) {
    const at = DP.where(req.query);
    const pg = DP.page(db, { cols: COLS, base: MINE, params: [m.id], at, limit: SHEET });
    const ids = pg.rows.map(w => w.id), held = heldOf(ids), shown = shownOf(ids);
    const total = Number(db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status IN ('held','hidden','restoring')").get(m.id).n) || 0;
    return { at, pg, total, rows: pg.rows.map(w => ({ w, held: held.get(Number(w.id)) || 0, shown: shown.get(Number(w.id)) || [] })) };
  }
  app.get('/account/table/inventory', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const I = inventory(req, m), c = COPY.cols;
    const link = extra => '/account/table/inventory?' + new URLSearchParams({ ...(I.at.q ? { q: I.at.q } : {}), ...extra }).toString();
    const nav = I.pg.newer || I.pg.older ? `<nav class="ppr-nav" aria-label="More works">${I.pg.newer ? `<a href="${esc(link({ after: I.pg.newer }))}" rel="prev">&larr; Newer</a>` : ''}${I.pg.older ? `<a href="${esc(link({ before: I.pg.older }))}" rel="next">Older &rarr;</a>` : ''}</nav>` : '';
    const csv = '/account/table/inventory.csv' + (Object.keys(req.query).length ? '?' + new URLSearchParams(Object.entries(req.query).filter(([k]) => ['q', 'before', 'after'].includes(k)).map(([k, v]) => [k, String(v)])).toString() : '');
    const pick = `<form class="ppr-pick" method="get" action="/account/table/inventory" role="search"><label><span>Find a work</span><input type="search" name="q" value="${esc(I.at.q)}" placeholder="A title, a place, an accession number" autocomplete="off"></label><button>Find</button><a href="${esc(csv)}" download>This page as a spreadsheet (CSV)</a><a href="/account/estate">The whole catalogue, in Your estate</a></form>`;
    const of = I.total > I.rows.length ? `${I.rows.length.toLocaleString('en-US')} of ${I.total.toLocaleString('en-US')} works${I.at.q ? `, matching “${I.at.q}”` : ''}` : `${I.rows.length.toLocaleString('en-US')} work${I.rows.length === 1 ? '' : 's'}${I.at.q ? `, matching “${I.at.q}”` : ''}`;
    sheet(res, { kind: 'inventory', title: `${COPY.names.inventory}: ${m.name}`, m, pick, req, body: `${head(m, 'Inventory of the work', of)}<p class="ppr-lede ppr-screen">${esc(COPY.inventoryLede)}</p>
${I.rows.length ? `<div class="ppr-x"><table class="ppr-t"><thead><tr><th scope="col"><span class="ppr-screen">Picture</span></th><th scope="col">${c.title}</th><th scope="col">${c.year}</th><th scope="col">${c.medium}</th><th scope="col">${c.size}</th><th scope="col">${c.edition}</th><th scope="col">${c.where}</th><th scope="col">${c.held}</th><th scope="col">${c.shown}</th><th scope="col">${c.here}</th></tr></thead><tbody>${I.rows.map(({ w, held, shown }) => `<tr><td>${thumb(w)}</td><td>${titleCell(w)}</td><td class="ppr-n">${esc(yearOf(w))}</td><td>${esc(mediumOf(w))}</td><td>${esc(sizeOf(w))}</td><td>${esc(editionOf(w))}</td><td>${esc(w.obj_located || '')}</td><td class="ppr-n">${held || ''}</td><td>${shown.length ? `<ul>${shown.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</td><td class="ppr-n">${COPY.here[w.status] || ''}</td></tr>`).join('')}</tbody></table></div>` : empty(I.at.q ? COPY.none.word(I.at.q) : COPY.none.inventory)}
${nav}${I.total > I.rows.length ? `<p class="ppr-note ppr-screen">${esc(COPY.inventoryWhole)}</p>` : ''}` });
  });
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s; };
  app.get('/account/table/inventory.csv', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const I = inventory(req, m);
    const headRow = ['accession', 'title', 'year', 'place', 'kind', 'medium', 'size', 'edition', 'signed', 'condition', 'where_it_is', 'at_watermark', 'pieces_held', 'shown', 'page'];
    const lines = I.rows.map(({ w, held, shown }) => [w.accession, tidy(w.title), yearOf(w), w.place, String(w.kind || 'photograph'), w.medium, sizeOf(w), editionOf(w), w.obj_signed, w.obj_condition, w.obj_located, COPY.here[w.status] || '', held, shown.join('; '), `${C.base}/w/${w.slug}`].map(cell).join(','));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${m.handle}-inventory.csv"`, 'Cache-Control': 'private, no-store' }).send('﻿' + [headRow.join(','), ...lines].join('\n') + '\n');
  });

  // ---- a price list: the prices the maker set, and a line to write another
  app.get('/account/table/prices', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const S = chosen(req, m), prints = printsOf(S.works.map(w => w.id)), c = COPY.cols;
    sheet(res, { kind: 'prices', title: `${COPY.names.prices}: ${m.name}`, m, req, pick: picker(req, '/account/table/prices'), body: `${head(m, 'Price list', S.label)}<p class="ppr-lede ppr-screen">${esc(COPY.pricesLede)}</p>
${S.works.length ? `<div class="ppr-x"><table class="ppr-t"><thead><tr><th scope="col">${c.no}</th><th scope="col">${c.title}</th><th scope="col">${c.year}</th><th scope="col">${c.medium}</th><th scope="col">${c.size}</th><th scope="col">${c.prints}</th><th scope="col">${c.other}</th></tr></thead><tbody>${S.works.map((w, i) => { const ps = prints.get(Number(w.id)) || [];
    return `<tr><td class="ppr-n">${i + 1}</td><td>${titleCell(w)}</td><td class="ppr-n">${esc(yearOf(w))}</td><td>${esc(mediumOf(w))}</td><td>${esc(sizeOf(w))}${editionOf(w) ? `<br><i>${esc(editionOf(w))}</i>` : ''}</td><td>${ps.length ? `<ul>${ps.map(p => `<li>${esc(p.label)} in, edition of ${Number(p.edition_n)}: ${esc(money(p.price_cents))}${p.framed_cents ? `; framed, ${esc(money(p.price_cents + p.framed_cents))}` : ''}</li>`).join('')}</ul>` : ''}</td><td><input class="ppr-in" aria-label="Another price for ${esc(tidy(w.title) || 'this work')}, as you state it" placeholder="${ps.length ? '' : esc(COPY.onRequest)}" autocomplete="off"></td></tr>`; }).join('')}</tbody></table></div>${tail(S)}` : empty(S.why)}` });
  });

  // ---- a consignment sheet: a form that carries what the maker states (docs/COUNSEL.md, 50)
  app.get('/account/table/consignment', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const S = chosen(req, m), c = COPY.cols, k = COPY.consign;
    const f = (label, attrs = '', wide = false) => `<label${wide ? ' class="ppr-w"' : ''}><span>${esc(label)}</span><input class="ppr-in" autocomplete="off" ${attrs}></label>`;
    sheet(res, { kind: 'consignment', title: `${COPY.names.consignment}: ${m.name}`, m, req, pick: picker(req, '/account/table/consignment'), body: `${head(m, 'Consignment sheet', S.label)}<p class="ppr-lede ppr-screen">${esc(COPY.consignLede)}</p><p class="ppr-notice" data-ppr-notice>${esc(COPY.consignNotice)}</p>
${S.works.length ? `<h2>${esc(k.parties)}</h2><div class="ppr-f">${f(k.maker, `value="${esc(m.name)}"`)}${f(k.other)}${f(k.address, '', true)}${f(k.from)}${f(k.until)}</div>
<h2>The works</h2><div class="ppr-x"><table class="ppr-t"><thead><tr><th scope="col">${c.no}</th><th scope="col">${c.title}</th><th scope="col">${c.year}</th><th scope="col">${c.medium}</th><th scope="col">${c.size}</th><th scope="col">${c.edition}</th><th scope="col">${k.price}</th></tr></thead><tbody>${S.works.map((w, i) => `<tr><td class="ppr-n">${i + 1}</td><td>${titleCell(w)}</td><td class="ppr-n">${esc(yearOf(w))}</td><td>${esc(mediumOf(w))}</td><td>${esc(sizeOf(w))}</td><td>${esc(editionOf(w))}</td><td><input class="ppr-in" aria-label="The price you state for ${esc(tidy(w.title) || 'this work')}" autocomplete="off"></td></tr>`).join('')}</tbody></table></div>${tail(S)}
<h2>${esc(k.terms)}</h2><div class="ppr-f">${f(k.share)}${f(k.paid)}${f(k.insured)}${f(k.carried)}${f(k.unsold, '', true)}<label class="ppr-w"><span>${esc(k.other2)}</span><textarea class="ppr-in" rows="3"></textarea></label></div>
<div class="ppr-sig"><div>${esc(k.signed)}: ${esc(k.maker).toLowerCase()}</div><div>${esc(k.date)}</div><div>${esc(k.signed)}: ${esc(k.other).toLowerCase()}</div><div>${esc(k.date)}</div></div>` : empty(S.why)}` });
  });

  // ---- a checklist for hanging: a selection of the maker's, or a whole wall for its curator
  const checkTable = (works, by) => { const c = COPY.cols; return `<div class="ppr-x"><table class="ppr-t"><thead><tr><th scope="col">${c.no}</th><th scope="col"><span class="ppr-screen">Picture</span></th><th scope="col">${c.title}</th>${by ? `<th scope="col">${c.maker}</th>` : ''}<th scope="col">${c.year}</th><th scope="col">${c.medium}</th><th scope="col">${c.size}</th><th scope="col">${c.edition}</th><th scope="col">${c.hung}</th><th scope="col">${c.label}</th><th scope="col">${c.notes}</th></tr></thead><tbody>${works.map((w, i) => `<tr><td class="ppr-n">${i + 1}</td><td>${thumb(w)}</td><td>${titleCell(w)}</td>${by ? `<td>${esc(w.maker_name || '')}</td>` : ''}<td class="ppr-n">${esc(yearOf(w))}</td><td>${esc(mediumOf(w))}</td><td>${esc(sizeOf(w))}</td><td>${esc(editionOf(w))}</td><td><span class="ppr-box"></span></td><td><span class="ppr-box"></span></td><td><span class="ppr-line"></span></td></tr>`).join('')}</tbody></table></div>`; };
  app.get('/account/table/checklist', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const S = chosen(req, m);
    sheet(res, { kind: 'checklist', title: `${COPY.names.checklist}: ${m.name}`, m, req, pick: picker(req, '/account/table/checklist'), body: `${head(m, 'Checklist', S.label)}<p class="ppr-lede ppr-screen">${esc(COPY.checklistLede)}</p>${S.works.length ? checkTable(S.works, false) + tail(S) : empty(S.why)}` });
  });
  app.get('/hang/:id/checklist', (req, res) => {
    const h = hangOf(req.params.id); if (!h || !curates(req, h)) return res.sendStatus(404);
    const rows = db.prepare(`SELECT ${COLS}, mk.name AS maker_name FROM works w JOIN hang_works hw ON hw.work_id=w.id JOIN makers mk ON mk.id=w.maker_id WHERE hw.hang_id=? AND w.status='held' ORDER BY hw.pos, w.id LIMIT ${SHEET + 1}`).all(h.id);
    const more = rows.length > SHEET; if (more) rows.length = SHEET;
    const bar = `<a href="/hang/${h.id}/checklist" aria-current="page">${COPY.names.checklist}</a><a href="/hang/${h.id}/labels">${COPY.names.labels}</a><a href="/hang/${h.id}/labels?prices=0">${COPY.names.labels}, without prices</a>`;
    sheet(res, { kind: 'checklist', title: `${COPY.names.checklist}: ${tidy(h.title)}`, m: null, bar, back: [`/hang/${h.slug}`, tidy(h.title)], body: `<h1>${esc(tidy(h.title))}</h1><p class="ppr-of">${rows.length} work${rows.length === 1 ? '' : 's'}${h.venue ? `, ${esc(h.venue)}` : ''}${h.opens_at ? `, ${esc(span(h.opens_at, h.closes_at))}` : ''}</p><p class="ppr-lede ppr-screen">${esc(COPY.checklistLede)}</p>${rows.length ? checkTable(rows, true) + tail({ more }) : empty(COPY.none.checklist)}` });
  });

  // ---- the exhibition history: what the record holds, by year
  function exhibitions(m) {
    const out = [];
    try {
      const places = db.prepare('SELECT id, venue, city, country, opens_on, until_on, afterwards, represents FROM onview_places WHERE maker_id=? AND removed_at IS NULL ORDER BY id DESC LIMIT 500').all(m.id).filter(s => !(s.until_on && s.until_on < day() && s.afterwards === 'gone'));
      const i = G.inList('showing_id', places.map(s => s.id));
      const n = places.length ? new Map(db.prepare(`SELECT showing_id, COUNT(*) AS n FROM onview_works WHERE ${i.sql} GROUP BY showing_id`).all(...i.args).map(r => [Number(r.showing_id), Number(r.n)])) : new Map();
      for (const s of places) { const k = n.get(Number(s.id)) || 0; if (!k) continue; out.push({ year: String(s.opens_on || s.until_on || '').slice(0, 4), when: span(s.opens_on, s.until_on), what: s.venue, where: [s.city, s.country].filter(Boolean).join(', '), note: `${k} work${k === 1 ? '' : 's'}${s.until_on && s.until_on < day() ? '' : s.opens_on && s.opens_on > day() ? ', to come' : ', on view now'}` }); }
    } catch (e) { /* no places yet */ }
    try {
      for (const l of db.prepare("SELECT l.show_title, l.venue, l.city, l.opens, l.closes, b.name AS borrower, COUNT(*) AS n FROM loans l JOIN makers b ON b.id=l.borrower_id WHERE l.lender_id=? AND l.status IN ('out','back','home') GROUP BY l.show_title, l.venue, l.city, l.opens, l.closes, b.name ORDER BY l.opens DESC LIMIT 500").all(m.id))
        out.push({ year: String(l.opens || l.closes || '').slice(0, 4), when: span(l.opens, l.closes), what: `“${l.show_title}”`, where: [l.venue, l.city].filter(Boolean).join(', '), note: `${Number(l.n)} work${Number(l.n) === 1 ? '' : 's'}, lent to ${l.borrower}` });
    } catch (e) { /* no loans yet */ }
    return out.sort((a, b) => String(b.year || '0000').localeCompare(String(a.year || '0000')) || String(a.what).localeCompare(String(b.what)));
  }
  app.get('/account/table/exhibitions', (req, res) => {
    const m = makerOf(req); if (!m) return signIn(req, res);
    const rows = exhibitions(m);
    sheet(res, { kind: 'exhibitions', title: `${COPY.names.exhibitions}: ${m.name}`, m, req, body: `${head(m, 'Exhibition history')}<p class="ppr-lede ppr-screen">${esc(COPY.exhibitionsLede)}</p>
${rows.length ? rows.map(r => `<div class="ppr-yr"><b>${esc(r.year || '')}</b><div>${esc(r.what)}${r.where ? `, ${esc(r.where)}` : ''}<span>${esc([r.when && r.when !== r.year ? r.when : '', r.note].filter(Boolean).join(' · '))}</span></div></div>`).join('') : empty(COPY.none.exhibitions)}<p class="ppr-note ppr-screen">${esc(COPY.exhibitionsOnly)}</p>` });
  });

  // The doors, for the rooms that lead here (the Library's line, Your estate).
  const links = () => KINDS.map(([k, h]) => [h, COPY.names[k]]);
  app.locals.papers = { links, COPY, SHEET, exhibitions, chosen };
  return app.locals.papers;
}
module.exports = { mountPapers, COPY };
