// The easel (Will, 20 Oct: people sit in front of work in a museum and draw, paint, sculpt: the master study; tap and
// wander into a focus mode where you pinch, scroll, zoom and hold one passage; Watermark should help people learn to
// draw and paint).
//   /easel/:slug: the work alone on the dark wall, held for a session. Pinch and drag to the passage you are studying
//   (wheel and keys on a computer); Hold locks the view so a stray touch never moves it; the screen stays awake.
//   The tools a drawing teacher hands you, each a key: Grid (G: thirds, then 6×4, then off) to plot the big shapes;
//   Mirror (M) to see your drawing's errors fresh; Values (V) to see light and dark without colour; Squint (S) to
//   lose the detail and keep the masses; Notan (N): two values, then five (an SVG filter, nothing uploaded, nothing
//   changed on the server); Timer (T): 5, 15, 30 or 60 minutes with a quiet chime, like a life-drawing session;
//   Wilhelm's three studies (the thumbnail of values in five minutes; the gesture in two lines; the copy in an hour),
//   from the guide's 'What to look for' when there is one. Esc, or Back, returns where you came from.
//   Reached from the stroll's rail (Study), the viewer's deck and the work page's acts. The picture is the wall copy
//   when the screen can use it, else large; nothing is laid over the pixels but what the student switches on.
function mountEasel(app, { db, V, mk, I }) {
  const { esc, tidy } = V;
  app.get('/easel/:slug', (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(req.params.slug); if (!w) return res.redirect('/wander');
    if (app.locals.zone && app.locals.zone.mature(w) && !app.locals.zone.open(req)) return res.redirect(`/w/${encodeURIComponent(w.slug)}`);
    const m = mk(w); const back = String(req.query.back || `/w/${w.slug}`).replace(/[^\w\-/?=&.%]/g, '') || `/w/${w.slug}`;
    let look = []; try { const c = w.closer ? JSON.parse(w.closer) : null; look = (c && c.study && c.study.look) ? c.study.look.slice(0, 3).map(x => (typeof x === 'string' ? x : x.what || x.text || '')).filter(Boolean) : []; } catch (e) { look = []; }
    const yr = (w.taken_at || '').slice(0, 4);
    const body = `<main class="ez" data-easel data-slug="${esc(w.slug)}" data-large="/img/${esc(w.slug)}/large" data-wall="/img/${esc(w.slug)}/wall" data-ar="${w.width && w.height ? (w.width / w.height).toFixed(4) : '1.5'}">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ez-notan2" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer></filter><filter id="ez-notan5" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncG type="discrete" tableValues="0 .25 .5 .75 1"/><feFuncB type="discrete" tableValues="0 .25 .5 .75 1"/></feComponentTransfer></filter></svg>
<div class="ez-stage" data-ez-stage><img class="ez-im" data-ez-im src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}" draggable="false"><div class="ez-grid" data-ez-grid hidden></div></div>
<header class="ez-top"><a class="ez-back" href="${esc(back)}">${I.back}<span>Back</span></a><p class="ez-plate"><b>${esc(tidy(w.title))}</b> · ${esc(m ? m.name : '')}${w.place ? ` · ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}</p><span class="ez-timer" data-ez-clock hidden></span></header>
<nav class="ez-tools" aria-label="The easel">
<button type="button" data-ez="grid" aria-pressed="false" title="Grid (G)"><span class="ez-k">G</span>Grid</button>
<button type="button" data-ez="mirror" aria-pressed="false" title="Mirror (M)"><span class="ez-k">M</span>Mirror</button>
<button type="button" data-ez="values" aria-pressed="false" title="Values (V)"><span class="ez-k">V</span>Values</button>
<button type="button" data-ez="squint" aria-pressed="false" title="Squint (S)"><span class="ez-k">S</span>Squint</button>
<button type="button" data-ez="notan" aria-pressed="false" title="Notan (N)"><span class="ez-k">N</span>Notan</button>
<button type="button" data-ez="hold" aria-pressed="false" title="Hold the view (L)"><span class="ez-k">L</span>Hold</button>
<button type="button" data-ez="timer" aria-pressed="false" title="Timer (T)"><span class="ez-k">T</span>Timer</button>
<button type="button" data-ez="fit" title="Fit (0)"><span class="ez-k">0</span>Fit</button>
<button type="button" data-ez="study" aria-pressed="false" title="The study (?)">${I.wilhelm}Study</button>
<button type="button" data-ez-hide title="Put the tools away (H, or Tab); a tap on the edge brings them back"><span class="ez-k">H</span>Hide</button>
</nav>
<button type="button" class="ez-peek" data-ez-peek hidden title="The tools (H)">${I.dial || I.wilhelm}</button>
<aside class="ez-study" data-ez-study hidden><p class="k">${I.wilhelm} Wilhelm · The master study</p>
<ol><li><b>Five minutes: the values.</b> Switch on Squint and Notan. Draw the picture the size of a postage stamp, nothing but the three or four masses of light and dark. Where does the eye go? That is where the biggest contrast is.</li>
<li><b>Two minutes: the gesture.</b> Grid on. Two or three lines only: the great diagonals and curves that hold the composition. No detail; the detail is a lie until the gesture is true.</li>
<li><b>An hour: the copy.</b> Fit, then zoom to one passage at a time and Hold it. Draw or paint what you see, not what you know. Check with Mirror; your errors show at once.</li></ol>
${look.length ? `<p class="k">What to look for, in this one</p><ul>${look.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<p class="note">Pinch or drag to a passage; a wheel or + − zooms; arrows move; Esc leaves. The screen stays awake while you work.</p></aside>
<div class="ez-timers" data-ez-timers hidden><span>A sitting of</span><button type="button" data-ez-min="5">5</button><button type="button" data-ez-min="15">15</button><button type="button" data-ez-min="30">30</button><button type="button" data-ez-min="60">60</button><span>minutes</span><button type="button" data-ez-min="0">Stop</button></div>
</main><script src="/static/easel.js?v=${V.VER}" defer></script>`;
    res.send(V.layout({ title: `${tidy(w.title)} · The easel`, path: '/easel', bare: true, body }));
  });
}
module.exports = { mountEasel };
