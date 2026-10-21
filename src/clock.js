// The clock (Will, 21 Oct: "a museum that's open 24/7, 365, but we use smart programming to do that; somebody doesn't
// have to constantly be manning the chat room"; "if you go during the day you get different content; late night,
// different content"; "fill the rooms with not only people but things; entertainment and education; a kids' corner, an
// all-day thing"). The programme: what the house offers at this hour, in the visitor's own time (the `wm_tz` cookie,
// set by the layout from the browser's zone; else New York). Five slots a day, each drawn from what the house already
// holds, so it plays by itself: a person adds to it, nobody carries it. Nothing here is a feed; each slot is a few
// things chosen for the hour. `programme(req, { maker })` scopes to one collection when a maker is given (the Met's
// morning is the Met's guide), else the house. Shown on /keys and /keys/at/:handle (`clockBlock`), and the kids'
// corner is its own door (/kids): works marked for all, four stars and up, the guide's first paragraph in plain words,
// the easel's games, nothing to buy, nothing to say to anyone.
const SLOTS = [
  { key: 'morning', from: 6, to: 11, name: 'Morning', line: 'One work, read slowly. The craft, the study, the kids’ corner.' },
  { key: 'day', from: 11, to: 17, name: 'Midday', line: 'Tours by the guides; the makers’ stories; the desk awake.' },
  { key: 'evening', from: 17, to: 21, name: 'Evening', line: 'The prelude: the wall of the night, the piano, the bench’s question.' },
  { key: 'late', from: 21, to: 24, name: 'Late', line: 'The balcony open; conversation; nothing kept.' },
  { key: 'night', from: 0, to: 6, name: 'The small hours', line: 'The collection alone on the dark wall. Sit a while.' },
];
function mountClock(app, { db, V, C, buyerOf }) {
  const { esc, tidy } = V;
  const zoneOf = req => { const z = req.cookies && req.cookies.wm_tz; try { if (z && /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+$/.test(z)) { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } } catch (e) { /* */ } return process.env.BALCONY_TZ || 'America/New_York'; };
  const hourIn = zone => +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: zone }).format(new Date()) % 24;
  const slotAt = h => SLOTS.find(s => h >= s.from && h < s.to) || SLOTS[0];
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (e) { return null; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return []; } };
  const w2 = w => (w ? { slug: w.slug, title: tidy(w.title), maker: w.maker, place: w.place } : null);
  // What the house has, scoped: a deterministic pick by the day so a slot holds still for the hour.
  function programme(req, { maker = null } = {}) {
    const zone = zoneOf(req), hour = hourIn(zone), slot = slotAt(hour);
    const day = Math.floor(Date.now() / 86400e3), mk = maker ? 'AND w.maker_id=? ' : '', ma = maker ? [maker.id] : [];
    const pick = (rows, k = 1) => (rows.length ? Array.from({ length: Math.min(k, rows.length) }, (_, i) => rows[(day + i * 7 + hour) % rows.length]) : []);
    const guided = all(`SELECT w.slug, w.title, w.place, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.closer IS NOT NULL AND w.zone='all' ${mk} ORDER BY w.stars DESC, w.id`, ...ma);
    const starred = all(`SELECT w.slug, w.title, w.place, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND (w.stars>=4 OR w.curated=1) AND w.zone='all' ${mk} ORDER BY w.id`, ...ma);
    const tours = all(`SELECT DISTINCT h.slug, h.title, h.line, b.name AS guide FROM hangs h JOIN tour_voices v ON v.hang_id=h.id JOIN buyers b ON b.id=h.buyer_id ${maker ? 'JOIN hang_works hw ON hw.hang_id=h.id JOIN works w ON w.id=hw.work_id' : ''} WHERE h.public=1 ${mk} ORDER BY h.updated_at DESC`, ...ma);
    const walls = all(`SELECT DISTINCT h.slug, h.title, h.line FROM hangs h ${maker ? 'JOIN hang_works hw ON hw.hang_id=h.id JOIN works w ON w.id=hw.work_id' : ''} WHERE h.public=1 ${mk} ORDER BY h.updated_at DESC LIMIT 40`, ...ma);
    const craft = all("SELECT slug, title, summary, section FROM guides WHERE status!='hidden' ORDER BY sort, id");
    const texts = all("SELECT slug, title, author FROM texts ORDER BY id DESC LIMIT 40");
    const nights = all("SELECT slug, title, city, at, kind FROM nights WHERE status='open' AND at > datetime('now') ORDER BY at LIMIT 3");
    const bench = maker ? all("SELECT bl.body, bl.name, w.slug, w.title FROM bench_lines bl JOIN works w ON w.id=bl.subject_id WHERE bl.kind='work' AND w.maker_id=? ORDER BY bl.id DESC LIMIT 3", maker.id) : all("SELECT bl.body, bl.name, w.slug, w.title FROM bench_lines bl JOIN works w ON w.id=bl.subject_id WHERE bl.kind='work' ORDER BY bl.id DESC LIMIT 3");
    const bal = app.locals.balcony ? app.locals.balcony.state() : null;
    const items = [];
    const work = (w, why) => w && items.push({ kind: 'work', href: `/w/${w.slug}`, img: `/img/${w.slug}/screen`, title: tidy(w.title), line: `${w.maker}${w.place ? ', ' + w.place : ''}`, why });
    const link = (href, title, line, why) => items.push({ kind: 'link', href, title, line, why });
    if (slot.key === 'morning') {
      work(pick(guided)[0], 'Read slowly, with the guide');
      const g = pick(craft)[0]; if (g) link(`/account/atelier#${g.slug}`, g.title, g.summary || g.section, 'The craft, from the Atelier');
      link('/kids', 'The kids’ corner', 'Find the three things; values in five minutes. Nothing to buy.', 'All day');
      work(pick(starred.slice().reverse())[0], 'To study at the easel');
    } else if (slot.key === 'day') {
      const t = pick(tours)[0]; if (t) link(`/tour/${t.slug}`, t.title, `A tour with ${t.guide || 'a guide'}${t.line ? ' · ' + t.line : ''}`, 'In the guide’s own voice'); else { const wl = pick(walls)[0]; if (wl) link(`/hang/${wl.slug}`, wl.title, wl.line || 'A wall hung by a curator', 'On view'); }
      work(pick(starred)[0], 'Today’s work');
      link('/guides', 'The guides', 'People who walk you through the work in their own voice.', 'Hear one, become one');
      if (!maker) link('/trade', 'For editors and companies', 'The desk is awake: every use, priced or asked.', 'Working hours');
    } else if (slot.key === 'evening') {
      if (bal && bal.wall) work({ ...bal.wall, maker: bal.wall.maker }, 'The wall of the night'); else work(pick(starred, 2)[1] || pick(starred)[0], 'A wall for the evening');
      const q = pick(bench)[0]; if (q) link(`/bench/${q.slug}`, q.title, `“${q.body.slice(0, 120)}${q.body.length > 120 ? '…' : ''}” — ${q.name}`, 'On the bench');
      link(maker ? `/balcony/at/${maker.handle}` : '/balcony', 'The balcony', `Opens at nine, New York time${bal && bal.host ? `; ${bal.host.name} hosting` : ''}.`, 'Tonight');
      const n = nights[0]; if (n) link(`/season/${n.slug}`, n.title, `${n.city || ''} · ${new Date(n.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`, 'The season');
    } else if (slot.key === 'late') {
      link(maker ? `/balcony/at/${maker.handle}` : '/balcony', 'The balcony', bal && bal.open ? `Open now${bal.present && bal.present.n ? ` · ${bal.present.n} in the room` : ''}. Nothing said is kept.` : 'The room for the late hours.', 'Now');
      if (bal && bal.wall) work({ ...bal.wall }, 'The wall of the night');
      const t = pick(texts)[0]; if (t) link(`/library/${t.slug}`, t.title, t.author || 'From the shelf', 'To read late');
      work(pick(guided, 3)[2] || pick(guided)[0], 'One more, before bed');
    } else {
      link(maker ? `/wander?maker=${maker.handle}` : '/wander', 'The night room', 'The collection alone on the dark wall. Sit a while: ninety seconds a work, the guide read, quiet music.', 'The small hours');
      work(pick(starred, 2)[1] || pick(starred)[0], 'Hold on this one');
      const t = pick(texts, 2)[1] || pick(texts)[0]; if (t) link(`/library/${t.slug}`, t.title, t.author || 'From the shelf', 'For the sleepless');
    }
    return { zone, hour, slot, items: items.filter(Boolean).slice(0, 4), next: SLOTS.find(s => s.from === slot.to) || SLOTS[4] };
  }
  const clockBlock = (p, { maker = null } = {}) => `<section class="ck"><p class="k">Now${maker ? ` at ${esc(maker.name)}` : ', in the house'} · ${esc(p.slot.name.toLowerCase())}, your time</p><h2>${esc(p.slot.line)}</h2>
<div class="ck-row">${p.items.map(i => `<a class="ck-i${i.kind === 'work' ? ' ck-w' : ''}" href="${esc(i.href)}">${i.img ? `<img src="${esc(i.img)}" alt="" loading="lazy">` : ''}<span class="ck-why">${esc(i.why)}</span><b>${esc(i.title)}</b><span>${esc(i.line || '')}</span></a>`).join('')}</div>
<p class="ck-next">Then ${esc(p.next.name.toLowerCase())}: ${esc(p.next.line)}</p></section>`;
  // The kids' corner.
  app.get('/kids', (req, res) => {
    const day = Math.floor(Date.now() / 86400e3);
    const rows = all("SELECT w.slug, w.title, w.place, w.closer, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.zone='all' AND (w.stars>=4 OR w.curated=1) ORDER BY w.id");
    const picks = rows.length ? Array.from({ length: Math.min(6, rows.length) }, (_, i) => rows[(day * 3 + i * 5) % rows.length]) : [];
    const firstLine = w => { try { const c = JSON.parse(w.closer || '{}'); const t = String(c.text || c.guide || '').split(/\n+/)[0] || ''; return t.split(/(?<=\.)\s/)[0].slice(0, 180); } catch (e) { return ''; } };
    const I = require('./icons');
    res.send(V.layout({ title: 'The kids’ corner · Watermark', path: '/kids', desc: 'A room for children: look, find, draw. Nothing to buy.', body: `<section class="cx-intro kd"><p class="k">The house · all day</p><h1>The kids’ corner.</h1>
<p class="lede">A room for looking. Six works chosen for today; under each, three things to find and a game at the easel. Nothing here is for sale and nobody here will talk to you; bring a grown-up to the bench if you want to say something.</p>
<p class="kd-wil">${I.wilhelm}<span>Wilhelm says: look first for a long time. Then look again.</span></p></section>
<section class="kd-grid">${picks.map(w => `<article class="kd-c"><a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy"></a><h2>${esc(tidy(w.title))}</h2><p class="kd-by">${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}</p>${firstLine(w) ? `<p class="kd-line">${esc(firstLine(w))}</p>` : ''}<p class="kd-acts"><a href="/easel/${esc(w.slug)}?back=/kids">Find the three things</a> · <a href="/easel/${esc(w.slug)}?back=/kids">Draw it in five minutes</a></p></article>`).join('') || '<p class="note">The corner is being hung. Come back in the morning.</p>'}</section>
<section class="cx-intro kd-foot"><p class="note">For grown-ups: the corner shows only work marked for everyone, graded four stars and up by its maker; the easel’s tools send nothing anywhere. <a href="/zone">The rooms and how the house keeps them</a>.</p></section>` }));
  });
  app.locals.clock = { programme, clockBlock, SLOTS, zoneOf, hourIn };
  return app.locals.clock;
}
module.exports = { mountClock, SLOTS };
