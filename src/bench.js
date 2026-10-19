// The benches (Will, 19 Oct: nothing social on the wall; the talk is in the Keys). Under every work and every wall
// there is a bench, one door away from the picture: the work small at the top like a slide at a lecture, the
// conversation beneath, chronological, signed, a sentence at least, no reactions, no counts on the wall, no
// down-votes; the maker's and the curator's regard ('well seen') is the only rating and a well-seen line rises.
// Reading is open to everyone. Speaking needs a key (the Keys) and, for a work, that you have stood before it:
// a minute in front of it, or holding it, or having made it, or having been well seen once anywhere. The guide
// opens each bench with a question from the study. Lines are told to the maker and are never on the register.
const KEY_SECONDS = Number(process.env.BENCH_SECONDS || 60);
const MIN = 20; // characters: a sentence at least
const PER = 6; // lines per ten minutes per person

function mountBench(app, { db, V, C, buyerOf, makerOf, isStudio, mk, notify }) {
  db.exec(`CREATE TABLE IF NOT EXISTS bench_lines (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, subject_id INTEGER NOT NULL, buyer_id INTEGER, maker_id INTEGER, name TEXT NOT NULL, body TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')), seen_at TEXT, removed_at TEXT);
    CREATE INDEX IF NOT EXISTS bench_subject ON bench_lines(kind, subject_id, at)`);
  const { esc, tidy, date } = V;
  const keys = () => app.locals.keys;
  const work = slug => db.prepare("SELECT w.*, m.name AS maker_name, m.handle AS maker_handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held'").get(String(slug));
  const hang = slug => db.prepare('SELECT h.*, b.name AS curator, b.code AS curator_code FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.slug=? AND h.public=1').get(String(slug));
  const lines = (kind, id) => db.prepare('SELECT * FROM bench_lines WHERE kind=? AND subject_id=? AND removed_at IS NULL ORDER BY (seen_at IS NOT NULL) DESC, id ASC LIMIT 300').all(kind, id);
  const count = (kind, id) => db.prepare('SELECT COUNT(*) n FROM bench_lines WHERE kind=? AND subject_id=? AND removed_at IS NULL').get(kind, id).n;
  const UNKIND = /\b(idiot|moron|stupid|ugly|trash|garbage|kill yourself|retard)\b/i;
  const LINK = /https?:\/\/|www\.|\.com\b|\.io\b/i;

  // Who is at the bench: a name to sign with, and whether they may speak here.
  function whoAt(req, kind, subject) {
    const b = buyerOf(req), m = makerOf(req); const K = keys();
    const name = (m && m.name) || (b && b.name) || null;
    const held = K ? K.holds(req) : {}; const keyed = Object.keys(held).length > 0;
    if (!keyed) return { b, m, name, may: false, why: 'The bench is for keyholders. Collect a work, or be invited, and the Keys are yours.' };
    if (!name) return { b, m, name, may: false, why: 'Give your name on your gallery first; every line here is signed.' };
    if (kind === 'hang' || isStudio(req)) return { b, m, name, may: true };
    const w = subject;
    if (m && m.id === w.maker_id) return { b, m, name, may: true, as: 'the maker' };
    const v = String((req.cookies && req.cookies.wm_v) || '').slice(0, 16);
    const stood = db.prepare(`SELECT COALESCE(SUM(seconds),0) s FROM stood WHERE work_id=? AND (${b ? 'buyer_id=? OR ' : ''}viewer=?)`).get(w.id, ...(b ? [b.id, v] : [v])).s;
    if (stood >= KEY_SECONDS) return { b, m, name, may: true, as: 'stood' };
    if (b && db.prepare("SELECT 1 FROM licenses WHERE buyer_id=? AND work_id=? AND status='active'").get(b.id, w.id)) return { b, m, name, may: true, as: 'holds' };
    if (b && (db.prepare('SELECT 1 FROM bench_lines WHERE buyer_id=? AND seen_at IS NOT NULL').get(b.id) || db.prepare('SELECT 1 FROM notes WHERE buyer_id=? AND seen_at IS NOT NULL').get(b.id))) return { b, m, name, may: true, as: 'well seen' };
    return { b, m, name, may: false, why: `You may speak once you have stood before it: a minute in front of the work (you have ${stood} second${stood === 1 ? '' : 's'}), or holding it.`, stood };
  }
  const canKeep = (req, kind, subject) => isStudio(req) || (kind === 'work' ? (makerOf(req) || {}).id === subject.maker_id : (buyerOf(req) || {}).id === subject.buyer_id);
  const hits = new Map(), slow = k => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 6e5); a.push(now); hits.set(k, a); return a.length > PER; };
  const question = w => { try { const c = JSON.parse(w.closer || '{}'); const q = c.study && Array.isArray(c.study.questions) && c.study.questions[0]; return q || null; } catch (e) { return null; } };

  function page({ req, kind, s, ok }) {
    const isW = kind === 'work'; const ls = lines(kind, s.id); const who = whoAt(req, kind, s); const keep = canKeep(req, kind, s);
    const title = isW ? tidy(s.title) : s.title; const back = isW ? `/m/${esc(s.maker_handle)}/${esc(s.slug)}` : `/hang/${esc(s.slug)}`;
    const q = isW ? question(s) : (s.line || null);
    const img = isW ? `/img/${esc(s.slug)}/screen` : (() => { const f = db.prepare('SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 1').get(s.id); return f ? `/img/${esc(f.slug)}/screen` : ''; })();
    const note = { said: 'Said. The maker will read it.', short: 'A sentence at least, please; a word is for the hat.', link: 'No links on the bench.', unkind: 'Not on this bench.', slow: 'You have said a few things; let the others speak.', no: who.why || 'Not yet.' }[ok];
    return V.layout({ title: `The bench · ${title} · Watermark`, path: '/keys', desc: `What the members say about ${title}.`, body: `<section class="bn"><header class="bn-h"><p class="k"><a href="/keys">The Keys</a> · The bench</p>
<figure class="bn-fig">${img ? `<a href="${back}"><img src="${img}" alt="${esc(title)}"></a>` : ''}<figcaption><i>${esc(title)}</i>${isW ? ` · ${esc(s.maker_name)}${s.place ? `, ${esc(s.place)}` : ''}` : ` · a wall hung by ${esc(s.curator || 'a curator')}`} · <a href="${back}">Back to it</a></figcaption></figure>
<h1>On the bench.</h1>
${q ? `<p class="bn-q">${V.markOf ? '' : ''}<span class="k">${isW ? 'Wilhelm asks' : 'The curator'}</span>${esc(q)}</p>` : ''}
<p class="bn-rule">Signed, a sentence at least, no counts, no down-votes. ${isW ? 'You may speak once you have stood before it.' : 'Keyholders may speak.'} ${ls.length ? `${ls.length} ${ls.length === 1 ? 'line' : 'lines'}.` : 'No one has spoken yet.'}</p></header>
${note ? `<p class="${/said/.test(ok) ? 'ok' : 'err'} bn-note">${esc(note)}</p>` : ''}
${ls.length ? `<ol class="bn-lines">${ls.map(l => `<li class="${l.seen_at ? 'seen' : ''}"><p class="bn-p">${esc(l.body)}</p><p class="bn-s"><b>${esc(l.name)}</b><span>${esc(date(l.at))}</span>${l.seen_at ? `<em>Well seen</em>` : ''}${app.locals.season ? app.locals.season.cardLink(req, l, kind === 'work' ? 'work:' + s.slug : 'wall:' + s.slug) : ''}${keep ? `<form method="post" action="/bench/line/${l.id}/${l.seen_at ? 'unseen' : 'seen'}" class="inline"><button class="link">${l.seen_at ? 'Unmark' : 'Well seen'}</button></form><form method="post" action="/bench/line/${l.id}/remove" class="inline"><button class="link">Remove</button></form>` : (who.b && l.buyer_id === who.b.id) ? `<form method="post" action="/bench/line/${l.id}/remove" class="inline"><button class="link">Remove</button></form>` : ''}</p></li>`).join('')}</ol>` : ''}
${who.may ? `<form method="post" action="${isW ? `/bench/${esc(s.slug)}` : `/bench/wall/${esc(s.slug)}`}" class="bn-f"><label><span>${esc(who.name)}${who.as === 'the maker' ? ', the maker' : ''}</span><textarea name="body" required minlength="${MIN}" maxlength="1200" rows="3" placeholder="What you would say, sitting here."></textarea></label><button class="buy-btn">Say it</button></form>` : `<p class="bn-no">${esc(who.why || '')}${!who.b && !who.m ? ` <a href="/signin?next=${encodeURIComponent(req.originalUrl)}">Sign in</a>.` : ''}</p>`}
</section>` });
  }
  app.get('/bench/wall/:slug', (req, res) => { const h = hang(req.params.slug); if (!h) return res.sendStatus(404); res.send(page({ req, kind: 'hang', s: h, ok: req.query.ok || null })); });
  app.get('/bench/:slug', (req, res) => { const w = work(req.params.slug); if (!w) return res.sendStatus(404); res.send(page({ req, kind: 'work', s: w, ok: req.query.ok || null })); });
  function say(req, res, kind, s, back) {
    const who = whoAt(req, kind, s); if (!who.may) return res.redirect(303, `${back}?ok=no`);
    const body = String((req.body || {}).body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (body.length < MIN || !/\s/.test(body)) return res.redirect(303, `${back}?ok=short`);
    if (LINK.test(body)) return res.redirect(303, `${back}?ok=link`);
    if (UNKIND.test(body)) return res.redirect(303, `${back}?ok=unkind`);
    if (slow(`${who.b ? 'b' + who.b.id : ''}${who.m ? 'm' + who.m.id : ''}${req.ip}`)) return res.redirect(303, `${back}?ok=slow`);
    db.prepare('INSERT INTO bench_lines (kind, subject_id, buyer_id, maker_id, name, body) VALUES (?,?,?,?,?,?)').run(kind, s.id, who.b ? who.b.id : null, who.m ? who.m.id : null, who.name, body);
    try {
      if (kind === 'work' && notify && (!who.m || who.m.id !== s.maker_id)) notify.tell({ maker_id: s.maker_id, kind: 'bench', slug: s.slug, href: `/bench/${s.slug}`, title: `${who.name} spoke on the bench under ${tidy(s.title)}`, body: body.slice(0, 140) });
      if (kind === 'hang' && notify && (!who.b || who.b.id !== s.buyer_id)) notify.tell({ buyer_id: s.buyer_id, kind: 'bench', href: `/bench/wall/${s.slug}`, title: `${who.name} spoke on the bench under ${s.title}`, body: body.slice(0, 140) });
    } catch (e) { /* notices are not load-bearing */ }
    res.redirect(303, `${back}?ok=said#end`);
  }
  app.post('/bench/wall/:slug', (req, res) => { const h = hang(req.params.slug); if (!h) return res.sendStatus(404); say(req, res, 'hang', h, `/bench/wall/${encodeURIComponent(h.slug)}`); });
  app.post('/bench/:slug', (req, res) => { const w = work(req.params.slug); if (!w) return res.sendStatus(404); say(req, res, 'work', w, `/bench/${encodeURIComponent(w.slug)}`); });
  app.post('/bench/line/:id/:act', (req, res) => {
    const l = db.prepare('SELECT * FROM bench_lines WHERE id=?').get(+req.params.id); if (!l) return res.sendStatus(404);
    const s = l.kind === 'work' ? db.prepare('SELECT * FROM works WHERE id=?').get(l.subject_id) : db.prepare('SELECT * FROM hangs WHERE id=?').get(l.subject_id); if (!s) return res.sendStatus(404);
    const keep = canKeep(req, l.kind, s), mine = (buyerOf(req) || {}).id === l.buyer_id || ((makerOf(req) || {}).id && (makerOf(req) || {}).id === l.maker_id);
    const act = req.params.act;
    if (act === 'remove' && (keep || mine)) db.prepare("UPDATE bench_lines SET removed_at=datetime('now') WHERE id=?").run(l.id);
    else if (act === 'seen' && keep) db.prepare("UPDATE bench_lines SET seen_at=datetime('now') WHERE id=?").run(l.id);
    else if (act === 'unseen' && keep) db.prepare('UPDATE bench_lines SET seen_at=NULL WHERE id=?').run(l.id);
    else return res.sendStatus(403);
    res.redirect(303, l.kind === 'work' ? `/bench/${encodeURIComponent(s.slug)}` : `/bench/wall/${encodeURIComponent(s.slug)}`);
  });
  // The door on the wall: one quiet line, never the lines themselves.
  const door = (kind, s) => { const n = count(kind, s.id); return `<a class="bn-door" href="${kind === 'work' ? `/bench/${esc(s.slug)}` : `/bench/wall/${esc(s.slug)}`}">${(app.locals.keys && app.locals.keys.MARK && app.locals.keys.MARK.bunch) || require('./icons').stand}<span>The bench</span><small>${n ? `${n} ${n === 1 ? 'line' : 'lines'}` : 'Sit a while'}</small></a>`; };
  app.locals.bench = { door, count, lines, whoAt };
  return app.locals.bench;
}
module.exports = { mountBench };
