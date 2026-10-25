// The almanack (Will, 25 Oct, after Franklin's Poor Richard: "what would he make"; the franchise of presses, the
// Gazette, the Almanack). A maker's annual: the year as one book, set by the house through the press from what the
// maker already put out: a note on the year in their own words, the year in numbers, every piece of writing of
// that year as a chapter, the records of the year, and every photograph of the year as a plate. Made or remade in
// one press of a button; read in the reading room, printed as a PDF, sold at the maker's price or given. It is an
// ordinary `texts` row of kind 'almanack', so the Library, the shelf, Wander, the reading list and the Bookshop
// already know it. One almanack per maker per year; remaking keeps its address.
function mountAlmanack(app, { db, V, C, ledger, makerOf }) {
  const { esc, tidy, money } = V; const FEE = require('./fee');
  const year = y => { const n = parseInt(y, 10); const now = new Date().getFullYear(); return n >= 1900 && n <= now ? n : now; };
  const slugOf = (m, y) => `${m.handle}-almanack-${y}`;
  const existing = (m, y) => db.prepare('SELECT * FROM texts WHERE slug=? AND maker_id=?').get(slugOf(m, y), m.id);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // What the year holds for this maker.
  function gather(m, y) {
    const Y = String(y);
    const works = db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' AND (substr(COALESCE(taken_at, created_at),1,4)=? ) ORDER BY COALESCE(taken_at, created_at), id").all(m.id, Y);
    const writing = db.prepare("SELECT * FROM texts WHERE maker_id=? AND status='held' AND public=1 AND kind NOT IN ('almanack','photobook') AND body IS NOT NULL AND (substr(created_at,1,4)=? OR year=?) ORDER BY created_at").all(m.id, Y, Y);
    let records = []; try { records = db.prepare("SELECT * FROM recordings WHERE source='maker' AND maker_id=? AND status IN ('playing','shelved') AND (substr(at,1,4)=? OR year=?) ORDER BY at").all(m.id, Y, Y); } catch (e) { records = []; }
    const ids = works.map(w => w.id);
    const q = (sql, ...a) => { try { return db.prepare(sql).get(...a) || {}; } catch (e) { return {}; } };
    const inIds = ids.length ? `(${ids.join(',')})` : '(0)';
    const collected = q(`SELECT COUNT(*) AS n, COUNT(DISTINCT COALESCE(buyer_id, licensee)) AS people FROM licenses WHERE status IN ('active','expired') AND price_cents>0 AND work_id IN ${inIds}`);
    const stood = q(`SELECT COUNT(*) AS n, COALESCE(SUM(seconds),0) AS s FROM stood WHERE work_id IN ${inIds}`);
    const hats = q(`SELECT COUNT(*) AS n FROM applause WHERE work_id IN ${inIds}`);
    const places = [...new Set(works.map(w => w.place).filter(Boolean))];
    return { works, writing, records, collected, stood, hats, places };
  }
  // The book, set from the year.
  function make(m, y, { note = '', price = null, pub = 1 } = {}) {
    const g = gather(m, y); const first = String(m.name || '').split(' ')[0];
    if (!g.works.length && !g.writing.length && !g.records.length) throw new Error(`Nothing of ${y} is held yet.`);
    const chapters = [];
    chapters.push(`## A note on the year\n\n${note.trim() || `What ${first} made in ${y}: ${[g.works.length ? plural(g.works.length, 'photograph') : null, g.writing.length ? plural(g.writing.length, 'piece') + ' of writing' : null, g.records.length ? plural(g.records.length, 'record') : null].filter(Boolean).join(', ')}, kept in the house and set here as one book.`}`);
    const nums = [
      g.works.length ? `${plural(g.works.length, 'photograph')} made${g.places.length ? `, in ${g.places.length === 1 ? g.places[0] : plural(g.places.length, 'place') + ': ' + g.places.slice(0, 8).join(', ') + (g.places.length > 8 ? ' and more' : '')}` : ''}.` : null,
      g.writing.length ? `${plural(g.writing.length, 'piece')} of writing, ${g.writing.reduce((n, t) => n + String(t.body || '').split(/\s+/).filter(Boolean).length, 0).toLocaleString('en-US')} words.` : null,
      g.records.length ? `${plural(g.records.length, 'record')} put on the turntable.` : null,
      g.collected.n ? `Collected ${plural(g.collected.n, 'time')}${g.collected.people > 1 ? `, by ${g.collected.people} people` : ''}.` : null,
      g.stood.n ? `Stood before ${plural(g.stood.n, 'time')}${g.stood.s > 120 ? `, ${Math.round(g.stood.s / 60).toLocaleString('en-US')} minutes in all` : ''}.` : null,
      g.hats.n ? `${plural(g.hats.n, 'tip')} of the hat.` : null,
    ].filter(Boolean);
    chapters.push(`## The year in numbers\n\nThe year, counted.\n\n${nums.join('\n\n')}`);
    for (const t of g.writing) chapters.push(`## ${tidy(t.title)}\n\n${String(t.body || '').replace(/^##?\s.*$/gm, s => '**' + s.replace(/^#+\s*/, '') + '**')}`);
    if (g.records.length) chapters.push(`## On the turntable\n\n${g.records.map(r => `*${tidy(r.title)}*${r.performer ? `, ${r.performer}` : ''}${r.composer ? ` · ${r.composer}` : ''}${r.line ? `. ${r.line}` : ''}`).join('\n\n')}`);
    const body = chapters.join('\n\n');
    const plates = g.works.map(w => ({ slug: w.slug, note: w.taken_at && String(w.taken_at).length > 4 ? new Date(String(w.taken_at).replace(' ', 'T')).toLocaleDateString('en-US', { month: 'long' }) : '' }));
    const cover = g.works.length ? (g.works.find(w => w.curated) || [...g.works].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0]) : null;
    const title = `${first}’s Almanack ${y}`; const summary = `The year ${y} as one book: ${[g.works.length ? plural(g.works.length, 'plate') : null, g.writing.length ? plural(g.writing.length, 'piece') + ' of writing' : null, g.records.length ? plural(g.records.length, 'record') : null].filter(Boolean).join(', ')}.`;
    const slug = slugOf(m, y); const was = existing(m, y);
    if (was) db.prepare("UPDATE texts SET title=?, summary=?, body=?, plates=?, price_cents=?, public=?, cover_work_id=?, year=?, updated_at=datetime('now') WHERE id=?").run(title, summary, body, JSON.stringify(plates), price, pub, cover ? cover.id : null, String(y), was.id);
    else db.prepare("INSERT INTO texts (slug, kind, title, author, maker_id, year, summary, body, plates, public, price_cents, terms, source, cover_work_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'held')").run(slug, 'almanack', title, m.name, m.id, String(y), summary, body, JSON.stringify(plates), pub, price, '© ' + m.name + '. All rights reserved.', null, cover ? cover.id : null);
    try { ledger.append(db, 'text.shelved', slug, { title, kind: 'almanack', from: 'almanack', year: y, plates: plates.length, remade: !!was }); } catch (e) { /* */ }
    return db.prepare('SELECT * FROM texts WHERE slug=?').get(slug);
  }
  const years = m => { const ys = new Set(); for (const r of db.prepare("SELECT DISTINCT substr(COALESCE(taken_at, created_at),1,4) AS y FROM works WHERE maker_id=? AND status='held'").all(m.id)) if (r.y) ys.add(r.y); for (const r of db.prepare("SELECT DISTINCT substr(created_at,1,4) AS y FROM texts WHERE maker_id=? AND status='held' AND kind<>'almanack'").all(m.id)) if (r.y) ys.add(r.y); return [...ys].sort().reverse(); };
  function page(m, { y, ok = null, err = null }) {
    const ys = years(m); const t = existing(m, y); const g = gather(m, y); const first = String(m.name || '').split(' ')[0];
    const mine = db.prepare("SELECT * FROM texts WHERE maker_id=? AND kind='almanack' AND status='held' ORDER BY year DESC").all(m.id);
    return V.layout({ title: 'The almanack · Your studio', studio: true, body: `<section class="studio-wrap pw al"><p class="k">The printing house</p><h1>${esc(first)}’s Almanack.</h1>
<p class="lede">Your year as one book, set by the house from what you have already put out: a note in your words, the year in numbers, your writing of the year as chapters, your records, and every photograph of the year as a plate. Read in the reading room, printed as a book, free or at your price. Remake it any time; it keeps its address.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}${err ? `<p class="ok">${esc(err)}</p>` : ''}
<form method="post" action="/account/almanack" class="pw-f">
<div class="pw-row"><label><span>The year</span><select name="year">${(ys.length ? ys : [String(new Date().getFullYear())]).map(v => `<option value="${esc(v)}"${String(y) === String(v) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label><label><span>Price, $ (blank: free to read)</span><input name="price" inputmode="decimal" value="${t && t.price_cents ? t.price_cents / 100 : ''}"></label></div>
<p class="al-has">In ${esc(String(y))} the house holds ${[g.works.length ? plural(g.works.length, 'photograph') : null, g.writing.length ? plural(g.writing.length, 'piece') + ' of writing' : null, g.records.length ? plural(g.records.length, 'record') : null].filter(Boolean).join(', ') || 'nothing yet'}${g.collected.n ? `; collected ${plural(g.collected.n, 'time')}` : ''}.</p>
<label><span>A note on the year <small>Your own words open the book. Paragraphs with a blank line between.</small></span><textarea name="note" rows="8" maxlength="12000">${esc(t ? (String(t.body || '').split(/\n\s*\n/).slice(1).join('\n\n').split(/\n## /)[0] || '') : '')}</textarea></label>
<label class="pw-chk"><input type="checkbox" name="public" value="1"${t ? (t.public ? ' checked' : '') : ' checked'}> Shown on your page, in the Library and in Wander</label>
<div class="pw-acts"><button class="buy-btn">${t ? 'Remake the almanack' : 'Make the almanack'}</button>${t ? `<a href="/read/${esc(t.slug)}">Read it</a> · <a href="/read/${esc(t.slug)}.pdf">The book, as a PDF</a> · <a href="/library/${esc(t.slug)}">Its page</a>` : ''}</div>
<p class="note">${FEE.yours(m.share_pct, 'yours').replace(/^the/, 'The')}${FEE.on() ? '; the house’s share is on top, as on a photograph' : ''}. The plates are the house’s screen copies; the masters stay in the vault.</p></form>
${mine.length ? `<h2>Your almanacks</h2><table class="tbl"><tr><th>Year</th><th>Plates</th><th>Price</th><th>Shown</th><th></th></tr>${mine.map(r => { let n = 0; try { n = JSON.parse(r.plates || '[]').length; } catch (e) { n = 0; } return `<tr><td><a href="/library/${esc(r.slug)}">${esc(r.year || '')}</a></td><td>${n}</td><td>${r.price_cents ? money(r.price_cents) : 'Free'}</td><td>${r.public ? 'Yes' : 'No'}</td><td><a href="/account/almanack?year=${esc(r.year || '')}">Remake</a> · <a href="/read/${esc(r.slug)}">Read</a></td></tr>`; }).join('')}</table>` : ''}
</section>` });
  }
  app.get('/account/almanack', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); V.setDeskPath && V.setDeskPath('/account/almanack'); const ys = years(m); res.send(page(m, { y: year(req.query.year || ys[0]), ok: req.query.ok || null })); });
  app.post('/account/almanack', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const b = req.body || {}; const y = year(b.year);
    try { const t = make(m, y, { note: String(b.note || '').replace(/\r\n?/g, '\n'), price: b.price ? Math.round(parseFloat(b.price) * 100) || null : null, pub: b.public ? 1 : 0 }); return res.redirect(`/account/almanack?year=${y}&ok=${encodeURIComponent(`${tidy(t.title)} is set: ${JSON.parse(t.plates || '[]').length} plates.`)}`); }
    catch (e) { return res.send(page(m, { y, err: e.message })); }
  });
  app.locals.almanack = { make, gather, years, existing };
  return app.locals.almanack;
}
module.exports = { mountAlmanack };
