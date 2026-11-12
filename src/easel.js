// The easel (Will, 20 Oct: people sit in front of work in a museum and draw, paint, sculpt: the master study; tap and
// wander into a focus mode where you pinch, scroll, zoom and hold one passage; Watermark should help people learn to
// draw and paint).
//   /easel/:slug: the work alone on the dark wall, held for a session. Pinch and drag to the passage you are studying
//   (wheel and keys on a computer); Hold locks the view so a stray touch never moves it; the screen stays awake.
//   The tools a drawing teacher hands you, each a key: Grid (G: thirds, then 6×4, then off) to plot the big shapes;
//   Mirror (M) to see your drawing's errors fresh; Values (V) to see light and dark without colour; Squint (S) to
//   lose the detail and keep the masses; Notan (N): two values, then five (an SVG filter, nothing uploaded, nothing
//   changed on the server); Timer (T): 5, 15, 30 or 60 minutes with a quiet chime, like a life-drawing session;
//   Al's three studies (the thumbnail of values in five minutes; the gesture in two lines; the copy in an hour),
//   from the guide's 'What to look for' when there is one. Esc, or Back, returns where you came from.
//   Reached from the stroll's rail (Study), the viewer's deck and the work page's acts. The picture is the wall copy
//   when the screen can use it, else large; nothing is laid over the pixels but what the student switches on.
function mountEasel(app, { db, V, mk, I }) {
  const { esc, tidy } = V;
  // The easel's own door (Will, 2 Nov: "put the easel on the forefront: people use these images as reference while they
  // paint and draw; the phone or the Duo on its stand is the easel"): choose a work to study. The masters (the public
  // domain's great works, an artist at a time with ?artist=), the house's best, and what you hold; a word finds any.
  app.get('/easel', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80); const artistSlug = String(req.query.artist || '').trim();
    const A = app.locals.art; const a = artistSlug && A ? A.bySlug(artistSlug) : null;
    const SEL = "SELECT w.slug, w.title, w.width, w.height, w.taken_at, w.artist_id, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND COALESCE(w.zone,'all')!='mature'";
    const masters = a ? db.prepare(`${SEL} AND w.artist_id=? ORDER BY w.taken_at, w.id LIMIT 300`).all(a.id) : db.prepare(`${SEL} AND w.artist_id IS NOT NULL AND m.kind='institution' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 60`).all();
    const best = a ? [] : db.prepare(`${SEL} AND (w.curated=1 OR w.stars>=4) AND (w.artist_id IS NULL OR m.kind<>'institution') ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 36`).all();
    const found = q ? db.prepare(`${SEL} AND (lower(w.title) LIKE ? OR lower(COALESCE(w.place,'')) LIKE ? OR lower(m.name) LIKE ?) ORDER BY w.curated DESC, w.stars DESC LIMIT 60`).all(...Array(3).fill(`%${q.toLowerCase()}%`)) : [];
    const artists = a ? [] : db.prepare("SELECT a.slug, a.name, COUNT(w.id) n FROM artists a JOIN works w ON w.artist_id=a.id AND w.status='held' GROUP BY a.slug, a.name HAVING COUNT(w.id) >= 3 ORDER BY COUNT(w.id) DESC LIMIT 16").all();
    const name = w => { if (w.artist_id && A) { const ar = A.ofWork(w); if (ar) return ar.name; } return w.maker; };
    const tile = w => `<a class="ezl-w" href="/easel/${esc(w.slug)}?back=${encodeURIComponent(req.originalUrl)}"><img src="/img/${esc(w.slug)}/screen" alt="" loading="lazy"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}><span><b>${esc(tidy(w.title))}</b>${esc(name(w))}${(w.taken_at || '').slice(0, 4) ? `, ${esc(w.taken_at.slice(0, 4))}` : ''}</span></a>`;
    const band = (h, line, list) => list.length ? `<section class="ezl-band"><header><h2>${h}</h2>${line ? `<p>${line}</p>` : ''}</header><div class="ezl-grid">${list.map(tile).join('')}</div></section>` : '';
    res.send(V.layout({ title: a ? `Study ${a.name} · The easel · Watermark` : 'The easel · Watermark', path: '/easel', desc: 'Study a great work the way painters always have: large, with values, notan, squint, a grid and a timer. Your phone or tablet on a stand, your sketchbook beside it.', body: `<main class="ezl"><header class="ezl-h"><p class="k">${a ? '<a href="/easel">The easel</a>' : 'Look'}</p><h1>${a ? `Study ${esc(a.name)}.` : 'The easel.'}</h1>
<p class="ezl-l">${a ? `Every work of ${esc(a.name)}’s in the house, in the order it was made. Choose one, set your phone or tablet on a stand, and draw.` : 'Painters have always learned by copying the masters. Choose a work, set your phone or tablet on a stand beside your sketchbook, and study it: the values, the big shapes, the gesture, then one passage at a time.'}</p>
<form class="ezl-f" action="/easel"><input name="q" value="${esc(q)}" placeholder="Find a work: a title, a place, an artist" aria-label="Find a work"><button class="buy-btn">Find</button></form>
${a ? '' : `<ol class="ezl-how"><li><b>Values</b><span>The picture in greys, and a tap tells you any passage’s value, 0 to 10.</span></li><li><b>Notan and squint</b><span>Two values, then five; the detail blurred away until only the masses are left.</span></li><li><b>Side by side</b><span>The colour beside the values, moving together as you zoom.</span></li><li><b>Grid, mirror, timer</b><span>Thirds, 4 × 4, 6 × 4; your errors seen fresh; a sitting of five minutes to an hour.</span></li><li><b>On the stand</b><span>Everything put away, the view held, the screen awake.</span></li></ol>`}</header>
${q ? band(`Found: ${esc(q)}`, `${found.length} work${found.length === 1 ? '' : 's'}`, found) : ''}
${artists.length ? `<nav class="ezl-art" aria-label="Study an artist">${artists.map(x => `<a href="/easel?artist=${esc(x.slug)}">${esc(x.name)} <small>${x.n}</small></a>`).join('')}</nav>` : ''}
${band(a ? 'In the order made' : 'The masters', a ? '' : 'Great works that belong to everyone', masters)}${band('From the collection', 'The house’s best, by living makers', best)}</main>` }));
  });
  app.get('/easel/:slug', (req, res) => {
    // A work not on view may be studied by those who may already see it (Will, 12 Nov: "you should be able to study a
    // work that is private… I just uploaded a portrait of myself that I want to paint"): its maker and the Studio
    // always; and, unless the maker keeps it back, whoever was sent it: anyone holding a live album's link, or, for a
    // private gallery, the people inside (the picture route's own rule, deliveries.mayView). Never cached, never indexed.
    let w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(req.params.slug); let quiet = false;
    if (!w) {
      const h = db.prepare("SELECT * FROM works WHERE slug=? AND status='hidden'").get(req.params.slug);
      const me = h && app.locals.accounts && app.locals.accounts.makerOf ? app.locals.accounts.makerOf(req) : null, D = app.locals.deliveries;
      const mine = h && ((me && me.id === h.maker_id) || (app.locals.isStudio && app.locals.isStudio(req)));
      const sent = h && !h.keep_back && D && (D.guarded(h.id) ? D.mayView(req, h) : D.inLive(h.id));
      if (!h || !(mine || sent)) return res.redirect('/wander');
      w = h; quiet = true; res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
    }
    if (app.locals.zone && app.locals.zone.mature(w) && !app.locals.zone.open(req)) return res.redirect(`/w/${encodeURIComponent(w.slug)}`);
    const m = mk(w); const home = quiet ? '/account/table' : `/w/${w.slug}`; let back = String(req.query.back || home).replace(/[^\w\-/?=&.%]/g, ''); if (!/^\/(?!\/)/.test(back)) back = home; // only a path of this house
    let look = []; try { const c = w.closer ? JSON.parse(w.closer) : null; look = (c && c.study && c.study.look) ? c.study.look.slice(0, 3).map(x => (typeof x === 'string' ? x : x.what || x.text || '')).filter(Boolean) : []; } catch (e) { look = []; }
    const yr = (w.taken_at || '').slice(0, 4);
    const body = `<main class="ez" data-easel data-slug="${esc(w.slug)}" data-large="/img/${esc(w.slug)}/large" data-wall="/img/${esc(w.slug)}/wall" data-ar="${w.width && w.height ? (w.width / w.height).toFixed(4) : '1.5'}">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ez-notan2" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer></filter><filter id="ez-notan5" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncG type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncB type="discrete" tableValues="0 .25 .5 .75 1"/></feComponentTransfer></filter></svg>
<div class="ez-stage" data-ez-stage><div class="ez-pane" data-ez-pane><img class="ez-im" data-ez-im src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}" draggable="false"><div class="ez-grid" data-ez-grid hidden></div><span class="ez-ring" data-ez-ring hidden></span></div><div class="ez-pane ez-pane2" data-ez-pane2 hidden><img class="ez-im" data-ez-im2 src="/img/${esc(w.slug)}/large" alt="" draggable="false" aria-hidden="true"><div class="ez-grid" data-ez-grid2 hidden></div></div></div>
<div class="ez-pick" data-ez-pickbox hidden><span class="ez-sw" data-ez-sw></span><div><b data-ez-pv>Tap the picture</b><i data-ez-hex></i></div><div class="ez-scale" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<span style="background:hsl(0,0%,${i * 10}%)" data-v="${i}"></span>`).join('')}</div></div>
<header class="ez-top"><a class="ez-back" href="${esc(back)}">${I.back}<span>Back</span></a><p class="ez-plate"><b>${esc(tidy(w.title))}</b> · ${esc(m ? m.name : '')}${w.place ? ` · ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}</p><span class="ez-timer" data-ez-clock hidden></span></header>
<nav class="ez-tools" aria-label="The easel">
<button type="button" data-ez="grid" aria-pressed="false" title="Grid (G)"><span class="ez-k">G</span>Grid</button>
<button type="button" data-ez="mirror" aria-pressed="false" title="Mirror (M)"><span class="ez-k">M</span>Mirror</button>
<button type="button" data-ez="values" aria-pressed="false" title="Values (V)"><span class="ez-k">V</span>Values</button>
<button type="button" data-ez="squint" aria-pressed="false" title="Squint (S)"><span class="ez-k">S</span>Squint</button>
<button type="button" data-ez="notan" aria-pressed="false" title="Notan (N)"><span class="ez-k">N</span>Notan</button>
<button type="button" data-ez="pick" aria-pressed="false" title="Value (P): tap any passage for its value, 0 black to 10 white, and its colour"><span class="ez-k">P</span>Value finder</button>
<button type="button" data-ez="compare" aria-pressed="false" title="Side by side (B): the colour beside the values, the notan or the squint, moving together"><span class="ez-k">B</span>Side by side</button>
<button type="button" data-ez="hold" aria-pressed="false" title="Hold the view (L)"><span class="ez-k">L</span>Hold</button>
<button type="button" data-ez="timer" aria-pressed="false" title="Timer (T)"><span class="ez-k">T</span>Timer</button>
<button type="button" data-ez="fit" title="Fit (0)"><span class="ez-k">0</span>Fit</button>
<button type="button" data-ez="study" aria-pressed="false" title="The study (?)">${I.easel}Study</button>
<button type="button" data-ez="stand" title="On the stand (Enter): the tools away, the view held, the screen awake; a tap in the corner brings them back"><span class="ez-k">↵</span>On the stand</button>
<button type="button" data-ez-hide title="Put the tools away (H, or Tab); a tap on the edge brings them back"><span class="ez-k">H</span>Hide</button>
</nav>
<button type="button" class="ez-peek" data-ez-peek hidden title="The tools (H)">${I.dial}</button>
<aside class="ez-study" data-ez-study hidden><p class="k">The master study</p>
<ol><li><b>Five minutes: the values.</b> Switch on Squint and Notan. Draw the picture the size of a postage stamp, nothing but the three or four masses of light and dark. Where does the eye go? That is where the biggest contrast is.</li>
<li><b>Two minutes: the gesture.</b> Grid on. Two or three lines only: the great diagonals and curves that hold the composition. No detail; the detail is a lie until the gesture is true.</li>
<li><b>An hour: the copy.</b> Fit, then zoom to one passage at a time and Hold it. Draw or paint what you see, not what you know. Check with Mirror; your errors show at once.</li></ol>
${look.length ? `<p class="k">What to look for, in this one</p><ul>${look.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<p class="note">Set your phone or tablet on a stand beside your sketchbook: On the stand puts everything away and holds the view. Pinch or drag to a passage; a wheel or + − zooms; arrows move; Esc leaves. The screen stays awake while you work.</p></aside>
<div class="ez-timers" data-ez-timers hidden><span>A sitting of</span><button type="button" data-ez-min="5">5</button><button type="button" data-ez-min="15">15</button><button type="button" data-ez-min="30">30</button><button type="button" data-ez-min="60">60</button><span>minutes</span><button type="button" data-ez-min="0">Stop</button></div>
</main><script src="/static/easel.js?v=${V.VER}" defer></script>`;
    res.send(V.layout({ title: `${tidy(w.title)} · The easel`, path: '/easel', bare: true, body }));
  });
}
module.exports = { mountEasel };
