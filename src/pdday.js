// Public Domain Day (Will, 5 Nov, after Scala Archives' reminders of "anniversaries and artists entering the public
// domain": "yes go ahead"). Every 1 January the work of the artists who died seventy years before enters the public
// domain in the countries that protect for life plus seventy, and in the United States what was first published
// ninety-five years before. The house knows every artist's dates (the hall, Wikidata, MoMA), so it can say who is
// coming, years ahead, and on the morning itself tell the register, the people who asked, and the house.
//   /public-domain            this January's artists, last January's, the years ahead, a word to be told
//   POST /public-domain/tell  an email (and, if given, one artist) kept in pd_watch; told once, that morning
//   the morning               a chore on 1 January (once a year, settings pd_day_<year>): `artist.entered` on the
//                             register for each artist (public), the artist pages redrawn, each watcher one letter,
//                             the house one letter with what to bring in (catalogue rows with an open photograph)
//   POST /studio/pd-day/run   the morning by hand (?year=), for the Studio and the tests
// The rule is the house's own (art.js rights): died more than PD_YEARS (70) years ago. Terms differ by country and by
// kind of work; the page says so, and that it is not legal advice.
const { PD_YEARS } = require('./art');

function mountPdDay(app, { db, V, C, ledger, mail, studioOnly }) {
  const { esc } = V;
  db.exec('CREATE TABLE IF NOT EXISTS pd_watch (id INTEGER PRIMARY KEY, email TEXT NOT NULL, artist_id INTEGER, at TEXT NOT NULL DEFAULT (datetime(\'now\')), told_year INTEGER)');
  db.exec('CREATE INDEX IF NOT EXISTS pd_watch_email ON pd_watch (email)');
  const thisYear = () => new Date().getUTCFullYear();
  const nextDay = () => thisYear() + 1; // the next 1 January
  const diedFor = j => j - PD_YEARS - 1; // in January j, those who died in j-71
  const usFor = j => j - 96; // and in the United States, work first published in j-96 (ninety-five years, to the year's end)
  const HOUSE = () => process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const get = k => { try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; } catch (e) { return null; } };
  const set = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

  // The artists who enter in January j: their held works on view and what the catalogues know of them.
  function entering(j, limit = 400) {
    const rows = db.prepare(`SELECT a.id, a.slug, a.name, a.born, a.died, a.nationality, a.movement,
        (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held') AS held,
        (SELECT COUNT(*) FROM catalogue c WHERE c.artist_id=a.id) AS known,
        (SELECT w.slug FROM works w WHERE w.artist_id=a.id AND w.status='held' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 1) AS cover
      FROM artists a WHERE a.died=? ORDER BY 6 DESC, 7 DESC, a.name LIMIT ?`).all(diedFor(j), limit);
    return rows;
  }
  const dateOf = j => `January 1, ${j}`;
  const card = a => `<a class="pdd-a${a.cover ? '' : ' pdd-plain'}" href="/art/${esc(a.slug)}">${a.cover ? `<img src="/img/${esc(a.cover)}/screen" alt="" loading="lazy">` : ''}<span class="pdd-t"><b>${esc(a.name)}</b><small>${esc([a.born && a.died ? `${a.born}–${a.died}` : a.died ? `d. ${a.died}` : '', a.nationality, a.movement].filter(Boolean).join(' · '))}</small>${a.held || a.known ? `<em>${a.held ? `${a.held} here` : ''}${a.held && a.known ? ' · ' : ''}${a.known ? `${a.known} known` : ''}</em>` : ''}</span></a>`;

  app.get(['/public-domain', '/public-domain-day', '/pd-day'], (req, res) => {
    const j = nextDay(); const now = entering(j, 120); const last = entering(j - 1, 60);
    const days = Math.ceil((Date.UTC(j, 0, 1) - Date.now()) / 864e5);
    const ahead = [1, 2, 3, 4, 5].map(i => ({ j: j + i, list: entering(j + i, 12) })).filter(x => x.list.length);
    const ok = req.query.ok === 'told' ? '<p class="ok">We will write to you that morning.</p>' : req.query.ok === 'bad' ? '<p class="ok">That email did not look right.</p>' : '';
    const pick = now.slice(0, 200).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    res.send(V.layout({ title: `Public Domain Day, ${j} · Watermark`, path: '/public-domain', desc: `Who enters the public domain on ${dateOf(j)}: the artists who died in ${diedFor(j)}, and in the United States the work first published in ${usFor(j)}.`, body: `<section class="pdd">
<header class="pdd-h"><p class="k">Public Domain Day</p><h1>${dateOf(j)}.</h1>
<p class="pdd-lede">${days > 0 ? `In ${days} day${days === 1 ? '' : 's'}, the` : 'Today the'} work of everyone who died in ${diedFor(j)} belongs to everyone, in the countries that protect for the artist’s life and seventy years. In the United States, work first published in ${usFor(j)} enters the same morning.</p>
<p class="pdd-n">${now.length ? `${now.length === 120 ? 'More than 120' : now.length} artist${now.length === 1 ? '' : 's'} the house knows` : 'No artist the house knows yet'} · the day the house opens their work to print, share and study.</p></header>
${ok}
<h2>Entering on ${dateOf(j)}</h2>
${now.length ? `<div class="pdd-g">${now.map(card).join('')}</div>` : '<p class="pdd-none">The house has no one in its records who died in ' + diedFor(j) + ' yet.</p>'}
<form class="pdd-tell" method="post" action="/public-domain/tell"><h3>Tell me that morning</h3><p>One letter on ${dateOf(j)}, nothing else.</p>
<input type="email" name="email" required placeholder="you@example.com" autocomplete="email"><select name="artist" aria-label="Which artist"><option value="">Everyone entering</option>${pick}</select><button type="submit">Tell me</button><input class="hpot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"></form>
${last.length ? `<h2>Entered on ${dateOf(j - 1)}</h2><div class="pdd-g pdd-g-s">${last.map(card).join('')}</div>` : ''}
${ahead.length ? `<h2>The years ahead</h2><div class="pdd-ah">${ahead.map(x => `<div><h3>${x.j}</h3><p>${x.list.map(a => `<a href="/art/${esc(a.slug)}">${esc(a.name)}</a>`).join(' · ')}</p></div>`).join('')}</div>` : ''}
<p class="pdd-fine">The house’s reading: life plus seventy years for an artist’s work, and ninety-five years from first publication in the United States. Terms differ by country, by kind of work, and for work unpublished, anonymous or made for hire; a photograph of a work can carry rights of its own. Check before you rely on it; this is not legal advice.</p>
</section>` }));
  });

  app.post('/public-domain/tell', (req, res) => {
    if (req.body.website) return res.redirect(303, '/public-domain?ok=told');
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect(303, '/public-domain?ok=bad');
    const aid = +req.body.artist || null;
    const have = db.prepare('SELECT COUNT(*) n FROM pd_watch WHERE email=?').get(email).n;
    if (have < 40 && !db.prepare('SELECT 1 FROM pd_watch WHERE email=? AND COALESCE(artist_id,0)=?').get(email, aid || 0)) db.prepare('INSERT INTO pd_watch (email, artist_id) VALUES (?, ?)').run(email, aid);
    res.redirect(303, '/public-domain?ok=told');
  });

  // The morning: once a year.
  async function morning(j = thisYear(), { force = false } = {}) {
    const key = `pd_day_${j}`; if (get(key) && !force) return { already: true };
    set(key, new Date().toISOString());
    const list = entering(j, 2000);
    for (const a of list) {
      try { ledger.append(db, 'artist.entered', a.slug, { name: a.name, died: a.died, year: j }); } catch (e) { /* */ }
      try { app.locals.art && app.locals.art.uncache(a.slug); } catch (e) { /* */ }
    }
    const ids = new Set(list.map(a => a.id)); const byId = new Map(list.map(a => [a.id, a]));
    const base = (C && C.base) || process.env.BASE_URL || '';
    const watchers = db.prepare('SELECT * FROM pd_watch WHERE COALESCE(told_year,0)<?').all(j);
    const per = new Map(); for (const w of watchers) { if (w.artist_id && !ids.has(w.artist_id)) continue; if (!per.has(w.email)) per.set(w.email, []); per.get(w.email).push(w); }
    let told = 0;
    for (const [email, ws] of per) {
      const named = ws.filter(w => w.artist_id).map(w => byId.get(w.artist_id)).filter(Boolean);
      const shown = (named.length ? named : list.slice(0, 12));
      if (!shown.length) continue;
      const text = `Today, ${dateOf(j)}, the work of ${shown.map(a => a.name).join(', ')}${!named.length && list.length > shown.length ? ` and ${list.length - shown.length} more` : ''} entered the public domain in the countries that protect for life plus seventy years.\n\n${shown.map(a => `${a.name}: ${base}/art/${a.slug}`).join('\n')}\n\nEveryone entering today: ${base}/public-domain\n\nWatermark`;
      try { if (mail && mail.send) await mail.send({ to: email, subject: `Public Domain Day: ${shown.length === 1 ? shown[0].name : `${shown[0].name} and more`}`, text }); told++; db.prepare('UPDATE pd_watch SET told_year=? WHERE email=?').run(j, email); } catch (e) { /* */ }
    }
    const toBring = list.filter(a => a.known > a.held);
    const house = `Public Domain Day, ${dateOf(j)}: ${list.length} artist${list.length === 1 ? '' : 's'} in the house's records entered the public domain (died ${diedFor(j)}). In the United States, work first published in ${usFor(j)} entered too.\n\n${toBring.length ? `To bring in (catalogue works not yet held):\n${toBring.slice(0, 60).map(a => `${a.name}: ${a.known - a.held} known · ${base}/studio/art/${a.slug}`).join('\n')}\n\n` : ''}${told} people were told.\n${base}/public-domain`;
    try { if (mail && mail.send) await mail.send({ to: HOUSE(), subject: `Public Domain Day ${j}: ${list.length} artists`, text: house }); } catch (e) { /* */ }
    try { ledger.append(db, 'pdday.morning', String(j), { artists: list.length, told }); } catch (e) { /* */ }
    return { year: j, artists: list.length, told, toBring: toBring.length };
  }

  app.post('/studio/pd-day/run', studioOnly, async (req, res) => {
    const j = +req.query.year || +req.body.year || thisYear();
    const r = await morning(j, { force: true });
    if (req.query.json || req.body.json) return res.json(r);
    res.redirect(303, '/public-domain');
  });

  if (!app.locals.noTimers) {
    const t = setInterval(() => { try { const ROLE = require('./role'); if (!ROLE.chores) return; const d = new Date(); if (d.getUTCMonth() === 0 && d.getUTCDate() <= 3 && d.getUTCHours() >= 10) morning(d.getUTCFullYear()).catch(e => console.error('[pd-day]', e.message)); } catch (e) { /* */ } }, 30 * 60e3); t.unref();
  }
  app.locals.pdDay = { entering, morning, diedFor, usFor, nextDay };
}

module.exports = { mountPdDay };
