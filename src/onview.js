// On view at (Will, 20 Nov: "see the work: it is on display here. It could be a gallery in Chelsea"; docs/MARKET.md,
// "On display here"; #166). A living maker's work says where the object can be seen, the way the house says it for a
// museum's object: the place, its street, its city and country, from and until which dates, the place's own link.
// It is a fact the maker (or the Studio) states, shown with who stated it: never a logo, never "in partnership with",
// never an endorsement, and "represents" only when the maker ticked that the place represents the work for sale.
//   `onview_places`: one place, stated once by a maker and reused for any of their works (venue, street, city, country,
//   url, enquire: an address or a link, opens_on, until_on, represents, afterwards: 'history' | 'gone', stated_by:
//   'maker' | 'studio', removed_at/removed_by). `onview_works` (showing_id, work_id, licence, prints): the works it
//   names, one line a work, and per work what the house still offers while the place represents it (default off).
//   Set on the work's own desk (/account|studio/works/:slug/onview), for the one work or every work of the same
//   maker in a hang at once. Drawn as a line on the work page, the maker's page and Wander's "about the work".
//   Represented: the way to buy is the place's ("Enquire with …", to its own address or link) and the house's offer
//   gate (`blocks`, read by listed()/offered() in app.js) closes Collect and the full original, and a licence or
//   prints unless the maker keeps them; no door then sells them. No money moves differently.
//   After the last date the line reads "Shown at …, <year>" or is gone (the maker's choice); gone also ends the
//   represented way to buy. Nothing is fetched from the place's site. Every word below (W) is a draft for Will.
const W = {
  onView: 'On view at', from: 'from', until: 'until', shownAt: 'Shown at',
  byMaker: 'Stated by the maker.', byStudio: 'Stated by Watermark.',
  represents: v => `${v} represents this work. The price and the terms are theirs.`,
  enquire: v => `Enquire with ${v}`,
  fromHouse: 'Also from the house', fromHouseLine: 'What the maker still offers here',
  wrong: 'Is this line wrong?', wrongLink: 'Ask for it to be corrected',
  makerHead: 'Where the work can be seen',
  works: n => `${n} work${n === 1 ? '' : 's'}`,
  deskHead: 'Where it can be seen',
  deskNote: 'If the object is on view somewhere, a gallery, a fair, a museum, say where. The page says it as a fact you state, with your name on it; never as a partnership.',
  deskNoteStudio: 'Stated by the Studio, the page says "Stated by Watermark".',
  reuse: 'A place you have named before', anew: 'A new place',
  venue: 'The place', street: 'Street', city: 'City', country: 'Country', url: 'Its web address', enq: 'How to enquire: an email or a link',
  opens: 'From', untilL: 'Until',
  repL: 'This place represents the work for sale', repNote: 'Then the way to buy is theirs: the page says "Enquire with" them, and the house does not offer Collect or the original beside it.',
  keepL: 'While it is represented, the house still offers', keepLic: 'a licence', keepPr: 'prints',
  afterL: 'After the last date', afterH: 'Say it was shown there', afterG: 'Take the line away',
  allL: 'Also every work of mine in', allNone: 'This work only',
  save: 'Save', unlink: 'Take the line off this work', remove: 'Remove this place from every work',
  now: 'Now:', none: 'No place is named for this work.', goneNow: 'Past its last date: no longer shown.',
  err: { venue: 'The place, its city and its country, please.', dates: 'The last date is before the first.', how: 'A represented work needs a way to enquire: an email or a link.', url: 'A web address begins with https://.' },
  ok: { saved: n => `Saved for ${n === 1 ? 'this work' : `${n} works`}.`, unlinked: 'The line is off this work.', removed: 'The place is removed from every work.' },
};

function mountOnView(app, { db, V, ledger, studioOnly, makerOf }) {
  const { esc } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS onview_places (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, venue TEXT NOT NULL, street TEXT, city TEXT, country TEXT, url TEXT, enquire TEXT,
      opens_on TEXT, until_on TEXT, represents INTEGER NOT NULL DEFAULT 0, afterwards TEXT NOT NULL DEFAULT 'history', stated_by TEXT NOT NULL DEFAULT 'maker', removed_at TEXT, removed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS onview_works (showing_id INTEGER NOT NULL, work_id INTEGER NOT NULL, licence INTEGER NOT NULL DEFAULT 0, prints INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (showing_id, work_id));
    CREATE INDEX IF NOT EXISTS onview_works_work ON onview_works (work_id);
    CREATE INDEX IF NOT EXISTS onview_places_maker ON onview_places (maker_id, id)`);
  const COLS = 's.id, s.maker_id, s.venue, s.street, s.city, s.country, s.url, s.enquire, s.opens_on, s.until_on, s.represents, s.afterwards, s.stated_by';
  const ONE = `SELECT ${COLS}, sw.licence, sw.prints FROM onview_works sw JOIN onview_places s ON s.id=sw.showing_id WHERE sw.work_id=? AND s.removed_at IS NULL ORDER BY s.id DESC LIMIT 1`;
  const today = () => new Date().toISOString().slice(0, 10);
  const stateOf = s => (s.until_on && s.until_on < today() ? 'past' : s.opens_on && s.opens_on > today() ? 'coming' : 'on');
  const shape = s => { if (!s) return null; s.state = stateOf(s); return s.state === 'past' && s.afterwards === 'gone' ? null : s; };
  // Read once a turn of the loop per work: a page that asks about every use asks the table once.
  let tick = null;
  const ofId = id => { if (!tick) { tick = new Map(); setImmediate(() => { tick = null; }); } if (!tick.has(id)) tick.set(id, shape(db.prepare(ONE).get(id) || null)); return tick.get(id); };
  const of = w => (w && w.id ? ofId(w.id) : null);
  const represented = w => { const s = of(w); return s && Number(s.represents) === 1 ? s : null; };
  // The offer gate: Collect and the full original are the place's while it represents the work; a licence and prints
  // only if the maker keeps them.
  const blocks = (w, key) => { const s = represented(w); if (!s) return false; if (key === 'social' || key === 'reference') return true; if (key === 'print') return Number(s.prints) !== 1; return Number(s.licence) !== 1; };

  // Dates in the visitor's style: the server writes the day in the visitor's language when it knows it, and the page
  // rewrites each <time> in the browser's own (a kept copy of a page was made for someone else).
  const localeOf = req => { const t = String((req && req.headers && req.headers['accept-language']) || '').split(',')[0].split(';')[0].trim(); try { return t && Intl.DateTimeFormat.supportedLocalesOf([t]).length ? t : 'en-GB'; } catch (e) { return 'en-GB'; } };
  const day = (d, loc) => { try { return new Intl.DateTimeFormat(loc || 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z')); } catch (e) { return d; } };
  const t = (d, loc) => `<time datetime="${esc(d)}" data-ovd>${esc(day(d, loc))}</time>`;
  const LOCAL = '<script>(function(){try{var f=new Intl.DateTimeFormat(undefined,{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});document.querySelectorAll("time[data-ovd]").forEach(function(e){e.textContent=f.format(new Date(e.getAttribute("datetime")+"T00:00:00Z"))})}catch(e){}})()</script>';
  const place = (s, full = true) => [full ? s.street : null, s.city, s.country].filter(Boolean).map(esc).join(', ');
  const name = s => (s.url ? `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.venue)}</a>` : esc(s.venue));
  // The line itself, as the house says it for a museum's object.
  function line(s, loc) {
    if (s.state === 'past') return `${W.shownAt} ${name(s)}${s.city || s.country ? ', ' + place(s, false) : ''}, ${esc(String(s.until_on).slice(0, 4))}.`;
    const when = s.state === 'coming' && s.opens_on ? ` ${W.from} ${t(s.opens_on, loc)}${s.until_on ? ` ${W.until} ${t(s.until_on, loc)}` : ''}` : s.until_on ? ` ${W.until} ${t(s.until_on, loc)}` : '';
    return `${W.onView} ${name(s)}, ${place(s)}${when}.`;
  }
  const who = s => (s.stated_by === 'studio' ? W.byStudio : W.byMaker);
  const enquireHref = (s, w) => { const e = String(s.enquire || ''); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return `mailto:${e}?subject=${encodeURIComponent(V.tidy ? V.tidy(w.title) : w.title)}`; return /^https?:\/\//.test(e) ? e : s.url || null; };

  // The work page: the line beside the picture, and, when represented, the way to buy.
  function forWork(w, req) {
    const s = of(w); if (!s) return null; const loc = localeOf(req);
    const rep = Number(s.represents) === 1; const href = rep ? enquireHref(s, w) : null;
    const html = `<div class="ovw" id="on-view"><p class="ovw-l">${line(s, loc)}</p><p class="ovw-by">${who(s)} <a href="/w/${esc(w.slug)}/claim?kind=venue">${W.wrong} ${W.wrongLink}</a></p></div>${LOCAL}`;
    const buy = rep ? `<section class="ovw-buy" id="enquire"><p class="ovw-rep">${esc(W.represents(s.venue))}</p>${href ? `<p><a class="buy-btn" href="${esc(href)}" rel="noopener"${/^https?:/.test(href) ? ' target="_blank"' : ''}>${esc(W.enquire(s.venue))}</a></p>` : ''}</section>` : '';
    return { html, buy, represented: rep, venue: s.venue };
  }
  // The maker's page: the places their work can be seen now (or was), each with how many works it names.
  function strip(m, req) {
    if (!m) return ''; let rows = [];
    try { rows = db.prepare(`SELECT ${COLS}, COUNT(sw.work_id) n FROM onview_places s JOIN onview_works sw ON sw.showing_id=s.id JOIN works w ON w.id=sw.work_id WHERE s.maker_id=? AND s.removed_at IS NULL AND w.status='held' GROUP BY ${COLS} ORDER BY s.id DESC LIMIT 6`).all(m.id); } catch (e) { return ''; }
    rows = rows.map(shape).filter(Boolean); if (!rows.length) return ''; const loc = localeOf(req);
    return `<div class="ovw-mk"><p class="k">${W.makerHead}</p><ul>${rows.map(s => `<li>${line(s, loc)} <small>${esc(W.works(Number(s.n) || 0))} · ${who(s)}</small></li>`).join('')}</ul></div>${LOCAL}`;
  }
  // Wander's "about the work": the same line, asked on the async path.
  async function plate(w, req) {
    const adb = app.locals.adb; if (!adb || !w || !w.id) return '';
    const s = shape(await adb.get(ONE, w.id).catch(() => null)); if (!s) return '';
    const rep = Number(s.represents) === 1, href = rep ? enquireHref(s, w) : null;
    return `<p class="wka-m ovw-wk">${line(s, localeOf(req))} <small>${who(s)}</small>${rep && href ? ` <a href="${esc(href)}" rel="noopener"${/^https?:/.test(href) ? ' target="_blank"' : ''}>${esc(W.enquire(s.venue))}</a>` : ''}</p>`;
  }

  // ---- The desk: fields on the work's own record ----
  const placesOf = makerId => db.prepare("SELECT id, venue, city, country FROM onview_places WHERE maker_id=? AND removed_at IS NULL ORDER BY id DESC LIMIT 20").all(makerId);
  const hangsWith = w => { try { return db.prepare('SELECT h.id, h.title FROM hang_works hw JOIN hangs h ON h.id=hw.hang_id WHERE hw.work_id=? ORDER BY h.id DESC LIMIT 12').all(w.id); } catch (e) { return []; } };
  function block(w, action, said) {
    const studio = /^\/studio\//.test(action);
    const s = db.prepare(ONE).get(w.id) || null; const cur = s || {};
    const places = placesOf(w.maker_id), hangs = hangsWith(w);
    const msg = W.err[said] ? `<p class="err">${esc(W.err[said])}</p>` : said && said.startsWith('ok-') ? `<p class="ok">${esc(said === 'ok-unlinked' ? W.ok.unlinked : said === 'ok-removed' ? W.ok.removed : W.ok.saved(Number(said.slice(6)) || 1))}</p>` : '';
    const v = k => esc(cur[k] || ''); const ck = c => (c ? ' checked' : '');
    return `<section class="ovw-d" id="on-view"><h2>${W.deskHead}</h2><p class="note">${W.deskNote}${studio ? ' ' + W.deskNoteStudio : ''}</p>${msg}
<p class="ovw-now">${s ? `${W.now} ${line({ ...s, state: stateOf(s) }, 'en-GB')} <small>${who(s)}${stateOf(s) === 'past' && s.afterwards === 'gone' ? ` ${W.goneNow}` : ''}</small>` : W.none}</p>
<form method="post" action="${action}" class="form ovw-f">
${places.length ? `<label>${W.reuse}<select name="place"><option value="">${W.anew}</option>${places.map(p => `<option value="${p.id}"${p.id === cur.id ? ' selected' : ''}>${esc([p.venue, p.city, p.country].filter(Boolean).join(', '))}</option>`).join('')}</select></label>` : ''}
<label>${W.venue}<input name="venue" maxlength="120" value="${v('venue')}"></label>
<label>${W.street}<input name="street" maxlength="160" value="${v('street')}" autocomplete="off"></label>
<div class="ovw-row"><label>${W.city}<input name="city" maxlength="80" value="${v('city')}"></label><label>${W.country}<input name="country" maxlength="80" value="${v('country')}"></label></div>
<label>${W.url}<input name="url" type="url" maxlength="300" value="${v('url')}" placeholder="https://"></label>
<label>${W.enq}<input name="enquire" maxlength="300" value="${v('enquire')}"></label>
<div class="ovw-row"><label>${W.opens}<input name="opens_on" type="date" value="${v('opens_on')}"></label><label>${W.untilL}<input name="until_on" type="date" value="${v('until_on')}"></label></div>
<label class="ovw-ck"><input type="checkbox" name="represents" value="1"${ck(Number(cur.represents) === 1)}> ${W.repL}</label><p class="note">${W.repNote}</p>
<fieldset class="ovw-fs"><legend>${W.keepL}</legend><label class="ovw-ck"><input type="checkbox" name="licence" value="1"${ck(Number(cur.licence) === 1)}> ${W.keepLic}</label><label class="ovw-ck"><input type="checkbox" name="prints" value="1"${ck(Number(cur.prints) === 1)}> ${W.keepPr}</label></fieldset>
<fieldset class="ovw-fs"><legend>${W.afterL}</legend><label class="ovw-ck"><input type="radio" name="afterwards" value="history"${ck(cur.afterwards !== 'gone')}> ${W.afterH}</label><label class="ovw-ck"><input type="radio" name="afterwards" value="gone"${ck(cur.afterwards === 'gone')}> ${W.afterG}</label></fieldset>
${hangs.length ? `<label>${W.allL}<select name="hang"><option value="">${W.allNone}</option>${hangs.map(h => `<option value="${h.id}">${esc(V.tidy ? V.tidy(h.title) : h.title)}</option>`).join('')}</select></label>` : ''}
<p><button class="btn" name="do" value="save">${W.save}</button>${s ? ` <button class="link" name="do" value="unlink">${W.unlink}</button> <button class="link" name="do" value="remove">${W.remove}</button>` : ''}</p></form></section>`;
  }

  const clean = (x, n) => String(x == null ? '' : x).trim().slice(0, n) || null;
  const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const told = (w, what, s) => { try { ledger.append(db, what, w.slug, { venue: s ? s.venue : null, by: s ? s.stated_by : null }); } catch (e) { /* the register is a nicety here */ } };
  function act(req, res, w, back, by) {
    const x = req.body || {}; const go = said => res.redirect(`${back}?ov=${encodeURIComponent(said)}#on-view`);
    const cur = db.prepare(ONE).get(w.id) || null;
    if (x.do === 'unlink') { if (cur) { db.prepare('DELETE FROM onview_works WHERE work_id=?').run(w.id); told(w, 'onview.removed', cur); } return go('ok-unlinked'); }
    if (x.do === 'remove') {
      if (cur) { db.prepare("UPDATE onview_places SET removed_at=datetime('now'), removed_by=? WHERE id=?").run(by, cur.id); for (const r of db.prepare('SELECT w.slug FROM onview_works sw JOIN works w ON w.id=sw.work_id WHERE sw.showing_id=? LIMIT 500').all(cur.id)) told({ slug: r.slug }, 'onview.removed', cur); }
      return go('ok-removed');
    }
    const url = clean(x.url, 300), enquire = clean(x.enquire, 300);
    if (url && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(url)) return go('url');
    if (enquire && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(enquire) && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(enquire)) return go('how');
    const f = { venue: clean(x.venue, 120), street: clean(x.street, 160), city: clean(x.city, 80), country: clean(x.country, 80), url, enquire, opens_on: isDay(x.opens_on) ? x.opens_on : null, until_on: isDay(x.until_on) ? x.until_on : null, represents: x.represents === '1' ? 1 : 0, afterwards: x.afterwards === 'gone' ? 'gone' : 'history' };
    if (!f.venue || f.venue.length < 2 || !f.city || !f.country) return go('venue');
    if (f.opens_on && f.until_on && f.until_on < f.opens_on) return go('dates');
    if (f.represents && !enquire && !url) return go('how');
    // Stored once: the chosen place (theirs, not removed) is brought up to date; otherwise a new one.
    const chosen = x.place ? db.prepare('SELECT id FROM onview_places WHERE id=? AND maker_id=? AND removed_at IS NULL').get(+x.place, w.maker_id) : null;
    let id;
    if (chosen) { id = chosen.id; db.prepare("UPDATE onview_places SET venue=?, street=?, city=?, country=?, url=?, enquire=?, opens_on=?, until_on=?, represents=?, afterwards=?, stated_by=?, updated_at=datetime('now') WHERE id=?").run(f.venue, f.street, f.city, f.country, f.url, f.enquire, f.opens_on, f.until_on, f.represents, f.afterwards, by, id); }
    else id = db.prepare('INSERT INTO onview_places (maker_id, venue, street, city, country, url, enquire, opens_on, until_on, represents, afterwards, stated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(w.maker_id, f.venue, f.street, f.city, f.country, f.url, f.enquire, f.opens_on, f.until_on, f.represents, f.afterwards, by).lastInsertRowid;
    // The works it names: this one, or every work of the same maker in the hang chosen (one that holds this work).
    let works = [{ id: w.id, slug: w.slug }];
    if (x.hang && db.prepare('SELECT 1 FROM hang_works WHERE hang_id=? AND work_id=?').get(+x.hang, w.id)) works = db.prepare('SELECT w.id, w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.maker_id=? ORDER BY hw.pos, w.id LIMIT 500').all(+x.hang, w.maker_id);
    const lic = x.licence === '1' ? 1 : 0, pr = x.prints === '1' ? 1 : 0; const s = { venue: f.venue, stated_by: by };
    for (const k of works) { db.prepare('DELETE FROM onview_works WHERE work_id=?').run(k.id); db.prepare('INSERT INTO onview_works (showing_id, work_id, licence, prints) VALUES (?,?,?,?)').run(id, k.id, lic, pr); told(k, 'onview.stated', s); }
    tick = null;
    return go('ok-' + works.length);
  }
  const findWork = slug => db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug));
  const mine = (req, res, next) => { const m = makerOf(req); const w = findWork(req.params.slug); if (!m || !w || w.maker_id !== m.id) return res.redirect('/signin?next=' + encodeURIComponent(`/account/works/${req.params.slug}`)); req.work = w; next(); };
  app.post('/account/works/:slug/onview', mine, (req, res) => act(req, res, req.work, `/account/works/${encodeURIComponent(req.work.slug)}`, 'maker'));
  app.post('/studio/works/:slug/onview', studioOnly, (req, res) => { const w = findWork(req.params.slug); if (!w) return res.redirect('/studio'); act(req, res, w, `/studio/works/${encodeURIComponent(w.slug)}`, 'studio'); });

  // The Studio's answer to a place that asked (the claim door, kind 'venue'): the line comes off the work at once.
  const takeOff = (w, by) => { const cur = db.prepare(ONE).get(w.id) || null; if (!cur) return false; db.prepare('DELETE FROM onview_works WHERE work_id=?').run(w.id); tick = null; told(w, 'onview.removed', { venue: cur.venue, stated_by: by }); return true; };
  app.locals.onview = { takeOff, of, represented, blocks, forWork, strip, plate, block, W };
  return app.locals.onview;
}

module.exports = { mountOnView, W };
