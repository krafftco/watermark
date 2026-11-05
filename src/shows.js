// The show (Will, 5 Nov: "we can't overwhelm people with 12,000 works of Monet. But we can do a tight show of Monet,
// just like a curator would"). The catalogue is the whole of an artist's work in the house, in the order it was made,
// and stays: the record, browsed by period. The show is a choice: SHOW_N works (24) chosen from it, the best of each
// period in proportion to how much of the life it was, hung in the order made, with a title and a line. It is a house
// wall (`hangs` with `artist_id`, slug show-<artist>), so Wander walks it, a curator's tools arrange it, and it can be
// shared. The house proposes it; a person opens it. While a show is open, the artist's page leads with it and Wander
// at /wander/art/<artist> walks the show; ?all=1 walks everything. Every title and line a draft.
function mountShows(app, { db, V, isStudio, ledger }) {
  const { esc } = V;
  const AP = require('./artistpage');
  const N = +(process.env.SHOW_N || 24);
  const ready = (() => { let done = false; return () => { if (done) return; if (!db.prepare("SELECT 1 FROM pragma_table_info('hangs') WHERE name='artist_id'").get()) db.exec('ALTER TABLE hangs ADD COLUMN artist_id INTEGER'); done = true; }; })();
  try { ready(); } catch (e) { /* hangs not yet made: the first use makes the column */ }
  const A = () => app.locals.art;
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
  const numWord = n => n <= 20 ? words[n] : n === 24 ? 'Twenty-four' : n === 30 ? 'Thirty' : n === 36 ? 'Thirty-six' : String(n);

  // How strongly a work asks to be in the show: the house's and the maker's eye first, then Al's, then the file.
  const extra = ids => { const out = new Map(); for (let i = 0; i < ids.length; i += 400) { const part = ids.slice(i, i + 400); if (!part.length) break; for (const r of db.prepare(`SELECT id, al_grade FROM works WHERE id IN (${part.map(() => '?').join(',')})`).all(...part)) { let g = null; try { g = JSON.parse(r.al_grade || 'null'); } catch (e) { /* */ } out.set(r.id, g && !g.refused ? +g.score || 0 : 0); } } return out; };
  const norm = t => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|study|sketch|version)\b/g, '').trim();
  function rank(ws) {
    const al = extra(ws.map(w => w.id));
    return ws.map(w => {
      const mp = w.width && w.height ? w.width * w.height / 1e6 : 0;
      let s = (w.curated ? 100 : 0) + (w.stars || 0) * 12 + (al.get(w.id) || 0) * 8 + Math.log2(1 + mp) * 3;
      if (mp && mp < 0.6) s -= 40; // a file too small to hang large
      if (w.width && w.height && Math.max(w.width / w.height, w.height / w.width) > 3.5) s -= 30; // a strip, a scroll's detail
      if (!w.y) s -= 6; // a show reads in time
      return { w, s };
    }).sort((x, y) => y.s - x.s);
  }
  // Seats by period, in proportion to the square root of how much of the work it holds (a long Giverny does not drown
  // the early years); every period with three works or more gets at least one; then the best of each, no title twice.
  function propose(a, n = N) {
    const ws = A().chronology(a); if (!ws.length) return [];
    n = Math.max(6, Math.min(80, +n || N));
    if (ws.length <= n) return ws.slice();
    const ch = AP.chapters(a, ws).filter(c => c.list.length);
    const weight = ch.map(c => Math.sqrt(c.list.length));
    const tot = weight.reduce((s, x) => s + x, 0);
    const seats = ch.map((c, i) => Math.min(c.list.length, Math.max(c.list.length >= 3 ? 1 : 0, Math.round(n * weight[i] / tot))));
    let k = seats.reduce((s, x) => s + x, 0);
    while (k > n) { const i = seats.indexOf(Math.max(...seats)); seats[i]--; k--; }
    const ranked = ch.map(c => rank(c.list));
    while (k < n) { let best = -1, bs = -Infinity; ranked.forEach((r, i) => { if (seats[i] < r.length && r[seats[i]].s > bs) { bs = r[seats[i]].s; best = i; } }); if (best < 0) break; seats[best]++; k++; }
    const out = [], titles = new Set();
    ranked.forEach((r, i) => {
      let took = 0;
      for (const x of r) { if (took >= seats[i]) break; const t = norm(x.w.title); if (t && titles.has(t)) continue; titles.add(t); out.push(x.w); took++; }
      for (const x of r) { if (took >= seats[i]) break; if (!out.includes(x.w)) { out.push(x.w); took++; } }
    });
    return out.sort((x, y) => (x.y || 99999) - (y.y || 99999) || x.id - y.id);
  }

  const showOf = (a, any = false) => { ready(); return db.prepare(`SELECT * FROM hangs WHERE artist_id=? ${any ? '' : 'AND public=1'} ORDER BY public DESC, updated_at DESC, id DESC LIMIT 1`).get(a.id) || null; };
  const worksOf = h => db.prepare("SELECT w.id, w.slug, w.title, w.taken_at, w.caption, w.medium, w.width, w.height, w.curated, w.stars, hw.note, m.handle, m.name AS maker_name FROM hang_works hw JOIN works w ON w.id=hw.work_id JOIN makers m ON m.id=w.maker_id WHERE hw.hang_id=? AND w.status='held' ORDER BY hw.pos, w.id").all(h.id);
  const span = ws => { const ys = ws.map(w => w.y).filter(Boolean); if (!ys.length) return ''; const lo = Math.min(...ys), hi = Math.max(...ys); return lo === hi ? `${lo}` : `${lo} to ${hi}`; };
  function hang(a, n) {
    ready(); const H = app.locals.hangs; const hb = H && H.houseBuyer ? H.houseBuyer() : null; if (!hb) return null;
    const list = propose(a, n); if (!list.length) return null;
    const all = A().chronology(a).length;
    let h = showOf(a, true);
    const line = `${numWord(list.length)} works${span(list) ? ` from ${span(list)}` : ''}, chosen from the ${all.toLocaleString('en-US')} in the house and hung in the order they were made.`;
    if (!h) {
      let slug = `show-${a.slug}`.slice(0, 90), i = 2; while (db.prepare('SELECT 1 FROM hangs WHERE slug=?').get(slug)) slug = `show-${a.slug}-${i++}`.slice(0, 90);
      db.prepare('INSERT INTO hangs (buyer_id, slug, title, line, public, artist_id) VALUES (?,?,?,?,0,?)').run(hb.id, slug, a.name, line, a.id);
      h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(slug);
    } else db.prepare("UPDATE hangs SET line=CASE WHEN line IS NULL OR line LIKE '% works%chosen from the %' THEN ? ELSE line END, updated_at=datetime('now') WHERE id=?").run(line, h.id);
    db.prepare('DELETE FROM hang_works WHERE hang_id=?').run(h.id);
    for (let i = 0; i < list.length; i += 200) { const part = list.slice(i, i + 200); db.prepare(`INSERT INTO hang_works (hang_id, work_id, pos) VALUES ${part.map(() => '(?,?,?)').join(',')}`).run(...part.flatMap((w, j) => [h.id, w.id, i + j])); }
    try { ledger.append(db, 'show.proposed', `hang-${h.id}`, { artist: a.slug, n: list.length }); } catch (e) { /* */ }
    A().uncache(a.slug);
    return db.prepare('SELECT * FROM hangs WHERE id=?').get(h.id);
  }

  // What the artist's page shows: the open show, with each work's year as the page reads it.
  function forPage(a) {
    const h = showOf(a); if (!h) return null;
    const ws = worksOf(h).map(w => ({ ...w, y: AP.madeIn(w, a) })); if (!ws.length) return null;
    return { title: h.title, line: h.line, slug: h.slug, works: ws, href: `/wander/art/${a.slug}`, all: `/wander/art/${a.slug}?all=1` };
  }

  // The Studio's panel on /studio/art/:slug.
  function desk(a) {
    const h = showOf(a, true); const ws = h ? worksOf(h) : []; const total = A().chronology(a).length;
    return `<section class="ax-edit ash-desk" id="show"><h2>The show</h2>
<p class="note">The catalogue is everything (${total.toLocaleString('en-US')} works). The show is a choice: the best of each period, in proportion, in the order made. The house proposes it; you open it. While it is open the artist’s page leads with it and Wander walks it.</p>
${h ? `<p class="ash-st">${h.public ? '<b>Open</b> on the artist’s page and in Wander' : '<b>Proposed</b>, not yet open'} · ${ws.length} works · <a href="${esc(app.locals.hangs && app.locals.hangs.href ? app.locals.hangs.href(h) : `/hang/${h.slug}`)}">Arrange it on the wall</a></p>
<div class="ash-strip">${ws.map(w => `<a href="/studio/works/${esc(w.slug)}" title="${esc(w.title)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div>
<form method="post" action="/studio/art/${esc(a.slug)}/show" class="ash-f"><input type="hidden" name="do" value="save"><label>Title<input name="title" value="${esc(h.title)}" maxlength="80"></label><label>The line<textarea name="line" rows="2" maxlength="300">${esc(h.line || '')}</textarea></label><button class="buy-btn">Save</button></form>
<form method="post" action="/studio/art/${esc(a.slug)}/show" class="ash-f ash-fr"><input type="hidden" name="do" value="${h.public ? 'close' : 'open'}"><button class="buy-btn">${h.public ? 'Close the show' : 'Open the show'}</button></form>` : ''}
<form method="post" action="/studio/art/${esc(a.slug)}/show" class="ash-f ash-fr"><input type="hidden" name="do" value="propose"><label>Works<input name="n" value="${h ? ws.length || N : N}" inputmode="numeric" size="3"></label><button class="buy-btn">${h ? 'Choose again' : 'Propose a show'}</button>${h ? '<small>Choosing again replaces the works; the title and a line you wrote stay.</small>' : ''}</form></section>`;
  }

  app.post('/studio/art/:slug/show', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const a = A().bySlug(String(req.params.slug)); if (!a) return res.sendStatus(404);
    const b = req.body || {}; const back = `/studio/art/${a.slug}`;
    if (b.do === 'propose') { const h = hang(a, b.n); return res.redirect(`${back}?ok=${h ? 'proposed' : 'noshow'}#show`); }
    const h = showOf(a, true); if (!h) return res.redirect(`${back}#show`);
    if (b.do === 'save') db.prepare("UPDATE hangs SET title=?, line=?, updated_at=datetime('now') WHERE id=?").run(String(b.title || '').trim().slice(0, 80) || a.name, String(b.line || '').trim().slice(0, 300) || null, h.id);
    if (b.do === 'open') { db.prepare("UPDATE hangs SET public=1, updated_at=datetime('now') WHERE id=?").run(h.id); try { ledger.append(db, 'hang.opened', `hang-${h.id}`, { title: h.title, slug: h.slug, show: a.slug }); } catch (e) { /* */ } }
    if (b.do === 'close') db.prepare("UPDATE hangs SET public=0, updated_at=datetime('now') WHERE id=?").run(h.id);
    A().uncache(a.slug);
    res.redirect(`${back}?ok=${b.do === 'open' ? 'opened' : b.do === 'close' ? 'closed' : 'saved'}#show`);
  });

  const api = { propose, hang, showOf, forPage, desk, N };
  app.locals.shows = api;
  return api;
}

module.exports = { mountShows };
