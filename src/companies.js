// Companies (Will, 3 Nov: "allow corporations to show off their artwork"; "brands are making art all the time";
// "Braun… Dieter Rams… the Apple design book"; "a semiconductor that looks like art"; the Bryce Corporation and
// How It's Made: "a beautiful art to manufacturing… portraits of their people who've been working there for
// however long… old machinery that feels like a relic, like it should live in a museum but lives in their factory").
// A company is a maker of kind 'company' (Studio → Accounts). Its page is its own museum, in rooms:
//   products   The products: what it made, photographed as objects (kind 'design', the designer named)
//   making     The making: the line, the process, the order of it
//   machines   The machines: the relics on the floor
//   people     The people: portraits of those who make it, their years there in the caption
//   archive    From the archive: drawings, papers, old advertisements, old photographs
//   collection The collection: art the company owns, by other artists (linked by artist_id)
// `works.co_room` holds the room (else read from the work: design → products, an artist → collection, else archive).
// Rights (counsel): owning a painting is not the right to show a photograph of it online (17 U.S.C. §109(c) covers
// the object, in person). A work by an artist under copyright, and a portrait of a person, hangs only when the company
// ticks that it holds the right (`works.show_ok`: a licence from the artist, the estate or its society; the person's
// consent); others' art is never sold or licensed from a company's page, the personal Collect included.
const ROOMS = [
  ['products', 'The products', 'What it made, photographed as the objects they are.'],
  ['making', 'The making', 'The line, the process, the order of it.'],
  ['machines', 'The machines', 'The relics on the floor, still working.'],
  ['people', 'The people', 'Those who make it, and how long they have.'],
  ['archive', 'From the archive', 'Drawings, papers, advertisements, the first photographs.'],
  ['collection', 'The collection', 'Art the company keeps, by other artists.'],
];
const ROOM = Object.fromEntries(ROOMS.map(r => [r[0], r]));

function mountCompanies(app, { db, V, ledger, isStudio, studioOnly, makerOf }) {
  const { esc, tidy } = V;
  const col = (t, c, d) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); };
  col('works', 'co_room', 'TEXT'); col('works', 'show_ok', 'INTEGER'); col('makers', 'founded', 'TEXT');
  const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';

  // A maker's kind, cached a minute (offered/listed ask it per use per work).
  const kinds = new Map(); let kindsAt = 0;
  const kindOf = id => {
    if (Date.now() - kindsAt > 60000) { kinds.clear(); kindsAt = Date.now(); }
    if (!kinds.has(id)) { const r = db.prepare('SELECT kind FROM makers WHERE id=?').get(id); kinds.set(id, r ? r.kind : null); }
    return kinds.get(id);
  };
  const isCo = w => !!(w && kindOf(w.maker_id) === 'company');
  const artistOf = w => (w && w.artist_id ? db.prepare('SELECT * FROM artists WHERE id=?').get(w.artist_id) : null);
  const roomOf = w => (ROOM[w.co_room] ? w.co_room : w.artist_id ? 'collection' : w.kind === 'design' ? 'products' : 'archive');
  // Another artist's work under copyright, kept by a company.
  const othersArt = w => { if (!isCo(w) || !w.artist_id) return false; const a = artistOf(w); if (!a) return false; const r = app.locals.art ? app.locals.art.rights(a, w) : { state: 'reserved' }; return r.state !== 'pd'; };
  // What needs the company's word before it hangs.
  const needsWord = w => isCo(w) && !w.show_ok && (othersArt(w) || roomOf(w) === 'people');
  const gate = w => (!needsWord(w) ? null : roomOf(w) === 'people' ? 'the word of each person shown: tick "Each person shown has agreed" on its record' : 'the right to show it online: tick "We hold the right to show it" on its record (a licence from the artist, the estate or their society)');
  // Others' art on a company's page is shown, never sold.
  const closed = w => othersArt(w);

  const yearOf = w => { const m = String(w.obj_made || '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || String(w.taken_at || '').match(/^(\d{4})/); return m ? +m[1] : null; };
  const r = w => (w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5);
  const tile = (w, line) => `<a class="cpy-t" href="/w/${esc(w.slug)}" style="--r:${r(w)}"><span class="cpy-f"><img src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></span><span class="cpy-c"><b>${esc(tidy(w.title))}</b>${line ? `<small>${line}</small>` : ''}</span></a>`;
  const lineOf = w => esc([w.designer, w.artist_name, yearOf(w)].filter(Boolean).join(' · '));
  const worksOf = m => db.prepare("SELECT w.*, a.name AS artist_name FROM works w LEFT JOIN artists a ON a.id=w.artist_id WHERE w.maker_id=? AND w.status='held' ORDER BY w.curated DESC, w.stars DESC, w.id").all(m.id);

  // The middle of the company's page: its rooms, then the history by decade.
  function page(m) {
    if (!m || m.kind !== 'company') return null;
    const ws = worksOf(m); if (!ws.length) return `<section class="cpy"><div class="mh-wrap"><p class="lede">The archive is being hung.</p></div></section>`;
    const by = {}; for (const w of ws) (by[roomOf(w)] = by[roomOf(w)] || []).push(w);
    const rooms = ROOMS.filter(([k]) => by[k] && by[k].length).map(([k, name, line]) => {
      const list = k === 'products' || k === 'archive' ? by[k].slice().sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999)) : by[k];
      return `<section class="cpy-room" id="${k}"><header class="cpy-h"><h2>${esc(name)}</h2><p>${esc(line)} <span>${list.length}</span></p></header><div class="cpy-row">${list.slice(0, 24).map(w => tile(w, lineOf(w))).join('')}</div>${list.length > 24 ? `<p class="cpy-more"><a href="/wander?maker=${esc(m.handle)}">All ${list.length}, one at a time →</a></p>` : ''}</section>`;
    }).join('');
    const own = ws.filter(w => roomOf(w) !== 'collection' && yearOf(w));
    const dec = {}; for (const w of own) { const d = Math.floor(yearOf(w) / 10) * 10; (dec[d] = dec[d] || []).push(w); }
    const ds = Object.keys(dec).map(Number).sort((a, b) => a - b);
    const history = ds.length > 1 ? `<section class="cpy-room cpy-hist" id="history"><header class="cpy-h"><h2>The history</h2><p>${esc(m.name)}, decade by decade${m.founded ? `, since ${esc(m.founded)}` : ''}.</p></header>${ds.map(d => `<div class="cpy-dec"><h3>${d}s</h3><div class="cpy-row">${dec[d].sort((a, b) => yearOf(a) - yearOf(b)).slice(0, 12).map(w => tile(w, lineOf(w))).join('')}</div></div>`).join('')}</section>` : '';
    return `<div class="cpy">${rooms}${history}</div>`;
  }
  // The doors at the head of the page.
  function strip(m) {
    if (!m || m.kind !== 'company') return '';
    const ws = worksOf(m); const n = k => ws.filter(w => roomOf(w) === k).length;
    let team = []; try { team = db.prepare("SELECT name, role FROM institution_staff WHERE maker_id=? AND status='on' ORDER BY role").all(m.id); } catch (e) { team = []; }
    return `<section class="mu-strip"><div class="mh-wrap"><p class="k">The company${m.founded ? ` · since ${esc(m.founded)}` : ''}</p><nav class="mu-doors">
${ROOMS.filter(([k]) => n(k)).map(([k, name, line]) => `<a href="#${k}"><b>${esc(name)}</b><span>${n(k)} · ${esc(line)}</span></a>`).join('')}
<a href="/wander?maker=${esc(m.handle)}"><b>Wander it</b><span>One at a time, edge to edge</span></a>
<a href="/frame/tv?set=maker:${esc(m.handle)}"><b>On your television</b><span>The archive on a Frame at home</span></a>
${m.site ? `<a href="${esc(m.site)}" rel="noopener"><b>Visit</b><span>${esc(m.site.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span></a>` : ''}
</nav>${team.length ? `<p class="mu-team">The desk: ${team.map(s => `${esc(s.name || '')} <i>${esc(s.role)}</i>`).join(' · ')}.</p>` : ''}</div></section>`;
  }

  // The work's record: which room, and the company's word where it is needed.
  function block(w, action) {
    if (!isCo(w)) return '';
    const room = roomOf(w); const art = othersArt(w);
    return `<section class="ob-set"><h2>On the company's page</h2><form method="post" action="${action}" class="ob-f"><label>Room<select name="room">${ROOMS.map(([k, name]) => `<option value="${k}"${room === k ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
${art || room === 'people' ? `<label class="ob-wide"><input type="checkbox" name="show_ok" value="1"${w.show_ok ? ' checked' : ''}> ${room === 'people' ? 'Each person shown has agreed to be shown here' : 'We hold the right to show it online (a licence from the artist, the estate or their society)'}</label><p class="note ob-wide">${art ? 'Owning the work is not the right to show a photograph of it on the web. It hangs once this is ticked, and it is never sold or licensed from your page.' : 'A portrait hangs once the person has said yes. A company’s use beyond its page waits for a release, as for any portrait.'}</p>` : ''}
<button class="buy-btn">Keep</button></form></section>`;
  }
  const setRoom = (w, b, who) => {
    const room = ROOM[b.room] ? b.room : roomOf(w);
    db.prepare('UPDATE works SET co_room=?, show_ok=? WHERE id=?').run(room, b.show_ok === '1' ? 1 : null, w.id);
    ledger.append(db, 'work.company', w.slug, { room, show_ok: b.show_ok === '1', by: who });
  };
  app.post('/account/works/:slug/company', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    setRoom(w, req.body || {}, m.handle); res.redirect(303, `/account/works/${encodeURIComponent(w.slug)}?ok=company`);
  });
  app.post('/studio/works/:slug/company', studioOnly, (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    setRoom(w, req.body || {}, 'studio'); res.redirect(303, `/studio/works/${encodeURIComponent(w.slug)}?ok=company`);
  });

  // The company's desk: its founding year, its rooms, and what waits for its word.
  app.get('/account/company', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/company'); if (m.kind !== 'company') return res.redirect('/account');
    const all = db.prepare("SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY id DESC LIMIT 2000").all(m.id);
    const wait = all.filter(needsWord); const n = k => all.filter(w => w.status === 'held' && roomOf(w) === k).length;
    res.send(V.layout({ title: 'Your company page · Watermark', path: '/account/company', body: `<section class="studio-wrap cpy-desk"><p class="k">The company</p><h1>${esc(m.name)}</h1>
<p class="lede">Your page is your own museum, in rooms. Put work in through <a href="/account/upload">the vault</a> (choose Designs for products), grade and publish it in <a href="/account/table">the Library</a>, and choose each work's room on its record.</p>
<form method="post" action="/account/company" class="ob-f"><label>Founded<input name="founded" maxlength="40" value="${esc(m.founded || '')}" placeholder="1921"></label><button class="buy-btn">Keep</button></form>
<h2>The rooms</h2><ul class="cpy-list">${ROOMS.map(([k, name, line]) => `<li><b>${esc(name)}</b> ${n(k)} on view <small>${esc(line)}</small></li>`).join('')}</ul>
<h2>Waiting for your word</h2>${wait.length ? `<ul class="cpy-list">${wait.map(w => `<li><a href="/account/works/${esc(w.slug)}">${esc(tidy(w.title))}</a> <small>${esc(gate(w))}</small></li>`).join('')}</ul>` : '<p class="note">Nothing.</p>'}
<p><a class="buy-btn" href="/m/${esc(m.handle)}">See your page</a> <a class="link" href="/account/staff">Your team</a></p></section>` }));
  });
  app.post('/account/company', (req, res) => {
    const m = makerOf(req); if (!m || m.kind !== 'company') return res.sendStatus(401);
    db.prepare('UPDATE makers SET founded=? WHERE id=?').run(String((req.body || {}).founded || '').replace(/<[^>]*>/g, '').trim().slice(0, 40) || null, m.id);
    res.redirect(303, '/account/company');
  });

  // The public index, and the offer.
  app.get('/companies', (req, res) => {
    const cos = db.prepare("SELECT m.*, (SELECT COUNT(*) FROM works w WHERE w.maker_id=m.id AND w.status='held') n FROM makers m WHERE m.kind='company' ORDER BY m.name").all().filter(c => c.n > 0);
    const cover = c => db.prepare("SELECT slug, width, height FROM works WHERE maker_id=? AND status='held' ORDER BY curated DESC, stars DESC, id LIMIT 1").get(c.id);
    res.send(V.layout({ title: 'Companies · Watermark', path: '/companies', desc: 'Companies as makers: their products, their making, their machines, their people and their archives, shown as the art they are.', body: `<section class="cpy-ix"><p class="k">Companies</p><h1>Companies are makers too.</h1>
<p class="lede">A company that makes things well is a studio by another name. Here they show what they made, how it is made, the machines that make it, the people who do, and what they have kept: photographed as it deserves, at full size.</p>
${cos.length ? `<div class="cpy-cos">${cos.map(c => { const w = cover(c); return `<a class="cpy-co" href="/m/${esc(c.handle)}">${w ? `<span class="cpy-f" style="--r:${r(w)}"><img src="/img/${esc(w.slug)}/large" alt="" loading="lazy"></span>` : ''}<b>${esc(c.name)}</b><small>${c.founded ? `Since ${esc(c.founded)} · ` : ''}${c.n} work${c.n === 1 ? '' : 's'}</small></a>`; }).join('')}</div>` : ''}
<section class="mu-grid">
<div><p class="k">The products</p><h2>The product as the object it is.</h2><p>A radio, a chip, a bag, a chair: shot the way a museum shoots a vase, held at full resolution, the designer named on the label.</p></div>
<div><p class="k">The making</p><h2>The order of the floor.</h2><p>The line, the press, the loom, the roll of film running through the printer. There is a beauty in how a thing is made, and almost nobody gets to see it.</p></div>
<div><p class="k">The machines</p><h2>Relics, still working.</h2><p>The machine that has run since 1962 belongs in a museum. It lives on the floor. Here it can be seen by everyone.</p></div>
<div><p class="k">The people</p><h2>Those who make it.</h2><p>Portraits of the people who have done the work for thirty years, hung only with their yes.</p></div>
<div><p class="k">From the archive</p><h2>A history in pictures.</h2><p>Drawings, papers, the first advertisements, the first photographs of the first building: the company decade by decade.</p></div>
<div><p class="k">The collection</p><h2>The art a company keeps.</h2><p>A bank's paintings, a firm's photographs: shown with the artists' permission, credited to them, never sold from here.</p></div>
</section>
<section class="mu-ask"><h2>Open your archive.</h2><p>Write to the house with the company's name and where its pictures are kept. The archive comes in through the vault, a watched folder or a feed; your team works it from one desk. <a class="buy-btn" href="mailto:${esc(HOUSE)}?subject=${encodeURIComponent('A company archive for Watermark')}">By letter</a> <a class="mu-alt" href="/museums">For museums</a></p><p class="note">Terms for companies are drawn up with counsel. Every word here is a draft.</p></section></section>` }));
  });

  app.locals.companies = { ROOMS, roomOf, isCo, othersArt, needsWord, gate, closed, page, strip, block };
  return app.locals.companies;
}
module.exports = { mountCompanies, ROOMS };
