// Your looking (Will, 17 Oct): the house keeps the record of what you stood in front of and for how long, the way
// a listening service keeps a year of listening, and tells it back: the photograph that held you longest, the one
// you keep returning to, the makers you lean toward, the firsts. And from it, a curator's eye: photographs you have
// not seen that sit beside what held you; chosen by Claude when a key is set (always labelled), by likeness when not;
// never the same set twice: what you have been shown is remembered and set aside, so there is always something new.
const { layout, esc, tidy, money } = require('./views');
const MODEL = () => process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const I = require('./icons');

function mountLooking(app, { db, C, buyerOf, mail, fetchImpl = (...a) => fetch(...a) }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('stood') WHERE name='visits'").get()) db.exec('ALTER TABLE stood ADD COLUMN visits INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS shown (id INTEGER PRIMARY KEY, buyer_id INTEGER, viewer TEXT, work_id INTEGER NOT NULL, why TEXT, by TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS shown_who ON shown (buyer_id, viewer, at);
    CREATE TABLE IF NOT EXISTS letters (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, month TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (buyer_id, month))`);
  const who = (b, v) => (b ? { sql: '(s.buyer_id=? OR s.viewer=?)', args: [b.id, String(v || '').slice(0, 16)] } : { sql: 's.viewer=?', args: [String(v || '').slice(0, 16)] });
  const viewerOf = req => (req.cookies && req.cookies.wm_v ? String(req.cookies.wm_v).slice(0, 16) : null);

  // The record.
  function record(b, v, { since = null } = {}) {
    const w = who(b, v); const when = since ? `AND s.at > ${since}` : '';
    const q = (sql, ...a) => db.prepare(sql).all(...w.args, ...a);
    const one = (sql, ...a) => db.prepare(sql).get(...w.args, ...a);
    const totals = one(`SELECT COUNT(*) n, COALESCE(SUM(s.seconds),0) secs, COALESCE(SUM(s.visits),0) visits FROM stood s WHERE ${w.sql} ${when}`);
    const longest = q(`SELECT wk.slug, wk.title, wk.place, s.seconds, s.visits, m.name AS maker FROM stood s JOIN works wk ON wk.id=s.work_id JOIN makers m ON m.id=wk.maker_id WHERE ${w.sql} ${when} AND wk.status='held' ORDER BY s.seconds DESC LIMIT 6`);
    const returned = q(`SELECT wk.slug, wk.title, s.visits, s.seconds FROM stood s JOIN works wk ON wk.id=s.work_id WHERE ${w.sql} ${when} AND wk.status='held' AND s.visits>1 ORDER BY s.visits DESC, s.seconds DESC LIMIT 5`);
    const makers = q(`SELECT m.name, m.handle, COUNT(*) n, SUM(s.seconds) secs FROM stood s JOIN works wk ON wk.id=s.work_id JOIN makers m ON m.id=wk.maker_id WHERE ${w.sql} ${when} GROUP BY m.id ORDER BY secs DESC LIMIT 5`);
    const places = q(`SELECT wk.place, COUNT(*) n, SUM(s.seconds) secs FROM stood s JOIN works wk ON wk.id=s.work_id WHERE ${w.sql} ${when} AND wk.place IS NOT NULL AND wk.place<>'' GROUP BY wk.place ORDER BY secs DESC LIMIT 5`);
    const firsts = one(`SELECT COUNT(*) n FROM stood s WHERE ${w.sql} ${when} AND s.n <= 100`).n;
    const hats = b ? db.prepare(`SELECT COUNT(*) n FROM applause WHERE buyer_id=? ${since ? `AND at > ${since}` : ''}`).get(b.id).n : 0;
    const collected = b ? db.prepare(`SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active' AND price_cents>0 ${since ? `AND starts_at > ${since}` : ''}`).get(b.id).n : 0;
    const walls = b ? db.prepare('SELECT COUNT(*) n FROM hangs WHERE buyer_id=?').get(b.id).n : 0;
    const hours = db.prepare(`SELECT CAST(strftime('%H', s.at) AS INTEGER) h, COUNT(*) n FROM stood s WHERE ${w.sql} ${when} GROUP BY h ORDER BY n DESC LIMIT 1`).get(...w.args);
    return { totals, longest, returned, makers, places, firsts, hats, collected, walls, hour: hours ? hours.h : null };
  }

  // The eye: what to show next. By likeness (place, maker, keywords, weighted by how long they stood), never what
  // they have seen or been shown; by Claude when the key is set, choosing from the same shortlist and saying why.
  function candidates(b, v, n = 60, k = 8) {
    const w = who(b, v);
    const seen = new Set(db.prepare(`SELECT s.work_id FROM stood s WHERE ${w.sql}`).all(...w.args).map(r => r.work_id));
    for (const r of db.prepare(`SELECT work_id FROM shown s WHERE ${w.sql.replace(/s\./g, 's.')} AND at > datetime('now','-14 days')`).all(...w.args)) seen.add(r.work_id);
    const taste = db.prepare(`SELECT wk.place, wk.maker_id, wk.keywords, s.seconds FROM stood s JOIN works wk ON wk.id=s.work_id WHERE ${w.sql} ORDER BY s.seconds DESC LIMIT 40`).all(...w.args);
    const wPlace = new Map(), wMaker = new Map(), wKey = new Map();
    for (const t of taste) { const k = 1 + Math.log1p(t.seconds || 0); if (t.place) wPlace.set(t.place, (wPlace.get(t.place) || 0) + k); wMaker.set(t.maker_id, (wMaker.get(t.maker_id) || 0) + k); for (const kw of String(t.keywords || '').toLowerCase().split(/[,;]\s*/).filter(Boolean)) wKey.set(kw, (wKey.get(kw) || 0) + k); }
    const stoodSet = new Set(db.prepare(`SELECT s.work_id FROM stood s WHERE ${w.sql}`).all(...w.args).map(r => r.work_id));
    const all = db.prepare("SELECT wk.id, wk.slug, wk.title, wk.place, wk.keywords, wk.maker_id, wk.stars, wk.curated, m.name AS maker FROM works wk JOIN makers m ON m.id=wk.maker_id WHERE wk.status='held' AND wk.disputed=0 AND m.standing='open'").all();
    let pool = all.filter(x => !seen.has(x.id));
    if (pool.length < k) pool = all.filter(x => !stoodSet.has(x.id)); // a small house: shown again before seen again
    const scored = pool.map(x => { let s = (x.stars || 0) * .4 + (x.curated ? 1 : 0) + Math.random() * .6; if (x.place && wPlace.has(x.place)) s += wPlace.get(x.place) * .8; if (wMaker.has(x.maker_id)) s += wMaker.get(x.maker_id) * .5; for (const kw of String(x.keywords || '').toLowerCase().split(/[,;]\s*/).filter(Boolean)) if (wKey.has(kw)) s += wKey.get(kw) * .6; return { ...x, score: s }; }).sort((a, c) => c.score - a.score);
    // Half close to their taste, half from further off: a curator shows you what you did not know you wanted.
    const near = scored.slice(0, Math.ceil(n / 2)), far = scored.slice(Math.ceil(n / 2)).sort(() => Math.random() - .5).slice(0, Math.floor(n / 2));
    return { picks: [...near, ...far], taste };
  }
  async function byClaude(b, v, cands, taste, k = 8) {
    const held = taste.slice(0, 10).map(t => `${t.place || 'no place'}; ${String(t.keywords || '').slice(0, 80)}; ${Math.round(t.seconds || 0)}s`).join('\n');
    const list = cands.map(c => `${c.id}: "${tidy(c.title)}" by ${c.maker}${c.place ? `, ${c.place}` : ''}${c.keywords ? ` [${String(c.keywords).slice(0, 80)}]` : ''}`).join('\n');
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 700, system: 'You are the eye of a photography house: a curator choosing what to show one visitor next. You are given what they stood in front of longest (place; keywords; seconds) and a shortlist of photographs they have not seen. Choose the given number. Show range: some beside their taste, some that stretch it; never all of one place or one maker. For each, one short line (under 14 words) in a restrained, precise voice that says why, addressed to them ("Because you stood before the dome for four minutes"). No hype. Answer as JSON only: [{"id": number, "why": "..."}]',
        messages: [{ role: 'user', content: `What held them:\n${held || '(nothing yet: choose a first look, varied)'}\n\nShortlist:\n${list}\n\nChoose ${k}.` }] }) });
    if (!r.ok) throw new Error(`eye ${r.status}`);
    const j = await r.json(); const text = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error('eye: no json');
    const by = new Map(cands.map(c => [c.id, c]));
    return JSON.parse(m[0]).map(x => ({ ...by.get(Number(x.id)), why: String(x.why || '').slice(0, 140) })).filter(x => x.slug).slice(0, k);
  }
  async function forYou(req, k = 8) {
    const b = buyerOf(req), v = viewerOf(req); if (!b && !v) return { picks: [], by: null };
    const { picks: cands, taste } = candidates(b, v, 60, k); if (!cands.length) return { picks: [], by: null };
    let picks = null, by = 'likeness';
    if (process.env.ANTHROPIC_API_KEY && taste.length) { try { picks = await byClaude(b, v, cands, taste, k); by = 'claude'; } catch (e) { console.error('[eye]', e.message); picks = null; } }
    if (!picks || !picks.length) { const said = new Set(); picks = cands.slice(0, k).map((c, i) => { const kws = String(c.keywords || '').split(/[,;]\s*/).filter(Boolean); const shared = kws.find(kw => taste.some(t => String(t.keywords || '').toLowerCase().includes(kw.toLowerCase()))); let why = shared && !said.has('k' + shared) ? `Because ${shared.toLowerCase()} held you.` : c.place && taste.some(t => t.place === c.place) && !said.has('p') ? `Because you lean toward ${c.place}.` : taste.some(t => t.maker_id === c.maker_id) && !said.has('m' + c.maker_id) ? `More from ${c.maker}.` : i >= k / 2 ? 'Further from what you know; a curator shows range.' : c.curated ? 'One of the house\'s jewels.' : 'Something you have not stood before.'; said.add(shared ? 'k' + shared : c.place ? 'p' : 'm' + c.maker_id); return { ...c, why }; }); by = 'likeness'; }
    const ins = db.prepare('INSERT INTO shown (buyer_id, viewer, work_id, why, by) VALUES (?,?,?,?,?)');
    for (const p of picks) ins.run(b ? b.id : null, v, p.id, p.why, by);
    return { picks, by };
  }

  // Pages.
  app.get('/yours/looking', async (req, res) => {
    const b = buyerOf(req), v = viewerOf(req); if (!b && !v) return res.redirect('/signin?next=/yours/looking');
    const span = req.query.span === 'all' ? null : "datetime('now','start of month')";
    const rec = record(b, v, { since: span }), all = span ? record(b, v) : rec;
    const fy = await forYou(req, 8);
    res.send(lookingPage({ b, rec, all, span: span ? 'month' : 'all', fy }));
  });
  app.get('/api/for-you', async (req, res) => { res.set('Cache-Control', 'private, no-store'); const fy = await forYou(req, Number(req.query.n) || 6); res.json({ by: fy.by, picks: fy.picks.map(p => ({ slug: p.slug, title: tidy(p.title), maker: p.maker, place: p.place, why: p.why, thumb: `/img/${p.slug}/thumb` })) }); });

  // The letter: on the first of the month, to everyone who stood in front of something and has an email, once:
  // the month, and one work the house would show them next, with Collect (Will, 25 Oct). Chosen as For you is
  // (the collector's own looking; Claude when the key is set, else likeness), only among what they may collect.
  const likenessWhy = (cands, taste, k) => { const said = new Set(); return cands.slice(0, k).map((c, i) => { const kws = String(c.keywords || '').split(/[,;]\s*/).filter(Boolean); const shared = kws.find(kw => taste.some(t => String(t.keywords || '').toLowerCase().includes(kw.toLowerCase()))); const why = shared && !said.has('k' + shared) ? `Because ${shared.toLowerCase()} held you.` : c.place && taste.some(t => t.place === c.place) && !said.has('p') ? `Because you lean toward ${c.place}.` : taste.some(t => t.maker_id === c.maker_id) && !said.has('m' + c.maker_id) ? `More from ${c.maker}.` : i >= k / 2 ? 'Further from what you know; a curator shows range.' : c.curated ? 'One of the house\'s jewels.' : 'Something you have not stood before.'; said.add(shared ? 'k' + shared : c.place ? 'p' : 'm' + c.maker_id); return { ...c, why }; }); };
  async function pickFor(b) {
    const cf = app.locals.collectFor; if (!cf) return null;
    const { picks: cands, taste } = candidates(b, null, 60, 3);
    const can = cands.map(c => ({ c, x: cf(b, c.slug) })).filter(p => p.x).slice(0, 12);
    if (!can.length) return null;
    let chosen = null;
    if (process.env.ANTHROPIC_API_KEY && taste.length) { try { chosen = (await byClaude(b, null, can.map(p => p.c), taste, 1))[0]; } catch (e) { console.error('[eye]', e.message); } }
    if (!chosen) chosen = likenessWhy(can.map(p => p.c), taste, 1)[0];
    const x = can.find(p => p.c.id === chosen.id).x;
    db.prepare('INSERT INTO shown (buyer_id, viewer, work_id, why, by) VALUES (?,?,?,?,?)').run(b.id, null, chosen.id, chosen.why, 'letter');
    return { ...chosen, w: x.w, u: x.u };
  }
  function letterFor(b, { month = null } = {}) {
    const since = month ? "datetime('now','start of month','-1 month')" : null;
    const rec = record(b, null, { since });
    return pickFor(b).then(p => {
      if (!p) return null;
      const mk = db.prepare('SELECT * FROM makers WHERE id=?').get(p.w.maker_id);
      const href = `${C.base}/m/${require('./views').makerSlug(mk)}/${p.slug}?from=letter`;
      return { base: C.base, month: new Date(Date.now() - 86400e3 * 15).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' }), feeOn: require('./fee').on(),
        pick: { title: p.title, maker: p.maker, place: p.place, year: p.w.taken_at ? String(p.w.taken_at).slice(0, 4) : '', why: p.why, img: `${C.base}/img/${p.slug}/screen?f=jpg`, href, price: money(p.u.price_cents) },
        rec: { n: rec.totals.n, minutes: rec.totals.secs >= 60 ? Math.round(rec.totals.secs / 60) : 0, longest: rec.longest[0] || null, makers: rec.makers.slice(0, 2).map(m => m.name) },
        lookingUrl: `${C.base}/yours/looking`, wanderUrl: `${C.base}/wander?at=${p.slug}`, standingUrl: app.locals.standingOrders ? `${C.base}/yours/standing` : null };
    });
  }
  async function letters({ force = false } = {}) {
    if (!mail.on() && !force) return 0;
    const month = new Date().toISOString().slice(0, 7); let sent = 0;
    const people = db.prepare("SELECT DISTINCT b.* FROM buyers b JOIN stood s ON s.buyer_id=b.id WHERE b.email IS NOT NULL AND b.email<>'' AND s.at > datetime('now','start of month','-1 month')").all();
    const LETTERS = require('./mail-letters');
    for (const b of people) {
      if (db.prepare('SELECT 1 FROM letters WHERE buyer_id=? AND month=?').get(b.id, month)) continue;
      if (app.locals.standingOrders && db.prepare("SELECT 1 FROM standing WHERE buyer_id=? AND status IN ('active','ending')").get(b.id)) continue; // a standing order already brings a piece
      try {
        const c = await letterFor(b, { month }); if (!c) continue;
        if (!c.rec.n) continue;
        await mail.send({ to: b.email, ...LETTERS.looking(c) });
        db.prepare('INSERT OR IGNORE INTO letters (buyer_id, month) VALUES (?,?)').run(b.id, month); sent++;
      } catch (e) { console.error('[letter]', e.message); }
    }
    return sent;
  }
  app.locals.looking = { record, forYou, candidates, letters, letterFor, pickFor };
  return app.locals.looking;
}

const mins = s => (s >= 3600 ? `${(s / 3600).toFixed(1)} hours` : s >= 60 ? `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? '' : 's'}` : `${s} second${s === 1 ? '' : 's'}`);
function forYouBlock(fy, { heading = 'For you', sub = null } = {}) {
  if (!fy || !fy.picks.length) return '';
  return `<section class="fy" id="for-you"><header class="gh"><h2>${esc(heading)}</h2><span>${sub || (fy.by === 'claude' ? 'chosen for you by the house\'s eye, with AI; never the same twice' : 'chosen by likeness to what held you; never the same twice')}</span></header>
<div class="fy-row">${fy.picks.map(p => `<a class="fy-c" href="/w/${esc(p.slug)}"><img src="/img/${esc(p.slug)}/thumb" alt="" loading="lazy"><b>${esc(tidy(p.title))}</b><small>${esc(p.maker)}${p.place ? ` · ${esc(p.place)}` : ''}</small><em>${esc(p.why || '')}</em></a>`).join('')}</div></section>`;
}
function lookingPage({ b, rec, all, span, fy }) {
  const t = rec.totals, top = rec.longest[0];
  const stat = (n, l) => `<div><b>${n}</b><span>${l}</span></div>`;
  return layout({ title: 'Your looking · Watermark', path: '/yours/looking', body: `<section class="narrow lk-pg">
<p class="k">Yours · seen by you alone</p><h1>Your looking.</h1>
<p class="lk-span"><a href="/yours/looking"${span === 'month' ? ' aria-current="page"' : ''}>This month</a> · <a href="/yours/looking?span=all"${span === 'all' ? ' aria-current="page"' : ''}>All time</a></p>
${t.n ? `<div class="lk-stats">${stat(t.n, 'photographs stood before')}${stat(mins(t.secs), 'in all')}${stat(rec.firsts, 'among the first hundred')}${stat(rec.hats, 'hats tipped')}${stat(rec.collected, 'collected')}${stat(rec.walls, 'walls hung')}</div>
${top ? `<section class="lk-hero"><a href="/w/${esc(top.slug)}"><img src="/img/${esc(top.slug)}/screen" alt=""></a><div><p class="k">The one that held you</p><h2><a href="/w/${esc(top.slug)}">${esc(tidy(top.title))}</a></h2><p>${esc(top.maker)}${top.place ? ` · ${esc(top.place)}` : ''} · ${mins(top.seconds)}${top.visits > 1 ? `, over ${top.visits} visits` : ''}</p></div></section>` : ''}
<div class="lk-cols">
<section><h3>Longest in front of</h3><ol class="lk-list">${rec.longest.map(x => `<li><a href="/w/${esc(x.slug)}"><img src="/img/${esc(x.slug)}/thumb" alt=""><span><b>${esc(tidy(x.title))}</b><small>${esc(x.maker)} · ${mins(x.seconds)}</small></span></a></li>`).join('')}</ol></section>
<section>${rec.returned.length ? `<h3>You keep coming back to</h3><ol class="lk-list">${rec.returned.map(x => `<li><a href="/w/${esc(x.slug)}"><img src="/img/${esc(x.slug)}/thumb" alt=""><span><b>${esc(tidy(x.title))}</b><small>${x.visits} visits</small></span></a></li>`).join('')}</ol>` : ''}
${rec.makers.length ? `<h3>You lean toward</h3><p class="lk-tags">${rec.makers.map(m => `<a href="/m/${esc(m.handle)}">${esc(m.name)}</a>`).join(' · ')}</p>` : ''}${rec.places.length ? `<h3>Places</h3><p class="lk-tags">${rec.places.map(p => esc(p.place)).join(' · ')}</p>` : ''}${rec.hour != null ? `<h3>Your hour</h3><p class="lk-tags">You look most around ${rec.hour % 12 || 12}${rec.hour < 12 ? ' in the morning' : rec.hour < 18 ? ' in the afternoon' : ' at night'}.</p>` : ''}</section></div>` : '<p class="note">Nothing yet. Stand in front of something; the house keeps the time.</p>'}
${forYouBlock(fy, { heading: 'What the house would show you next' })}
<p class="note">Kept for you alone; the house tells no one what you looked at. ${b && b.email ? 'On the first of each month a short letter tells you your month.' : '<a href="/signin?next=/yours/looking">Sign in</a> and your looking follows you to every device, and a short letter tells you your month.'}</p>
</section>` });
}

module.exports = { mountLooking, forYouBlock, lookingPage };
